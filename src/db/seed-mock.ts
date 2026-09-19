/**
 * Fills a guild with FICTIONAL members and activity so every command-center
 * screen has something to show: ranking, builds, loot, meme raffle, bosses.
 *
 *   npm run db:seed:mock -- <guild-slug>
 *
 * Nothing here is real data. Mock members get an `@guildmate.invalid` address
 * and a random `supabase_user_id` that matches no Supabase account, so they
 * can never sign in. The script refuses to run twice on the same guild.
 *
 * It writes CONFIRMED ledger rows directly, which the app itself never does:
 * each one belongs to a CONFIRMED mock event that met its quorum, exactly the
 * state the sweep would have produced. It is a fixture, not a code path.
 */
import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })

const HOUR = 3_600_000
const DAY = 24 * HOUR

const CLASSES = [
  'Punisher',
  'Phantom',
  'Enforcer',
  'Psypher',
  'Dreadnought',
  'Technician',
  'Arbiter',
  'Demolisher',
] as const

const NAMES = [
  'Kaelthor', 'Vexmora', 'Draxion', 'Lunethra', 'Orvyn', 'Zephyrax', 'Myrkana', 'Thornvald',
  'Seraphyn', 'Grimwald', 'Ixalia', 'Brontus', 'Velkaris', 'Nyxara', 'Quorvan', 'Solthea',
  'Ravokk', 'Elowyn', 'Tarvesh', 'Zyndra', 'Hollgar', 'Ceryth', 'Maldrek', 'Ophyra',
  'Krelos', 'Veyla', 'Durnok', 'Ashvane',
]

const ALT_SUFFIX = ['Jr', 'Alt', 'Mule', 'Bank']

const BOSS_GROUPS = [
  { name: 'Grupo Aurora A', respawnKind: 'DAILY' as const, dailyTimes: '16:00, 22:30' },
  { name: 'Grupo Aurora B', respawnKind: 'DAILY' as const, dailyTimes: '19:00' },
  { name: 'Grupo Abismo D', respawnKind: 'INTERVAL' as const, intervalHours: 42, anchorInHours: 5 },
  { name: 'Grupo Abismo E', respawnKind: 'INTERVAL' as const, intervalHours: 48, anchorInHours: 17 },
  { name: 'Chefes de Fim de Semana', respawnKind: 'WEEKLY' as const, dailyTimes: '21:00', weekdays: '0,6' },
]

const BOSSES: { name: string; location: string; group: number | null }[] = [
  { name: 'Nv. 66 Colosso de Ferrugem', location: 'Forja Abandonada', group: 0 },
  { name: 'Nv. 67 Sentinela Eterna', location: 'Colina dos Pioneiros', group: 0 },
  { name: 'Nv. 68 Enxame Carmesim', location: 'Favelas de Areia', group: 1 },
  { name: 'Nv. 70 Garra Mecânica', location: 'Ferro-Velho Oeste', group: 1 },
  { name: 'Nv. 74 Titã das Dunas', location: 'Deserto Silente', group: 2 },
  { name: 'Nv. 76 Arauto da Guerra', location: 'Ruínas Partidas', group: 2 },
  { name: 'Nv. 78 Devorador Abissal', location: 'Fenda Profunda', group: 3 },
  { name: 'Nv. 80 Rainha Parasita', location: 'Colmeia Esquecida', group: 3 },
  { name: 'Nv. 82 Oráculo Quebrado', location: 'Templo Submerso', group: 4 },
  { name: 'Nv. 85 Leviatã de Aço', location: 'Porto Morto', group: 4 },
  { name: 'Nv. 72 Carniçal Errante', location: 'Pântano Cinzento', group: null },
]

/** Deterministic PRNG, so two runs on two guilds look alike but not identical. */
function prng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

async function main() {
  const slug = process.argv[2]?.trim().toLowerCase()
  if (!slug) {
    console.error('[seed-mock] usage: npm run db:seed:mock -- <guild-slug>')
    process.exit(1)
  }

  // Imported only now: the env above has to be loaded before the pool exists.
  const { db } = await import('./index')
  const schema = await import('./schema')
  const { and, desc, eq, like } = await import('drizzle-orm')
  const { eventCodeLookup, generateEventCode, hashEventCode } = await import('../lib/crypto')
  const { buildLootWheel } = await import('../lib/rules')

  const [guild] = await db.select().from(schema.guilds).where(eq(schema.guilds.slug, slug)).limit(1)
  if (!guild) {
    console.error(`[seed-mock] guild "${slug}" not found`)
    process.exit(1)
  }

  const [already] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.guildId, guild.id), like(schema.users.email, 'mock-%@guildmate.invalid')))
    .limit(1)
  if (already) {
    console.info(`[seed-mock] guild "${slug}" already has mock data, nothing to do`)
    process.exit(0)
  }

  const random = prng([...slug].reduce((sum, ch) => sum + ch.charCodeAt(0), 7))
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const now = new Date()

  console.info(`[seed-mock] seeding "${guild.name}"`)

  await db.transaction(async (tx) => {
    await tx.insert(schema.guildSettings).values({ guildId: guild.id }).onConflictDoNothing()

    // --- Weeks -------------------------------------------------------------
    const existingWeeks = await tx
      .select()
      .from(schema.guildWeeks)
      .where(eq(schema.guildWeeks.guildId, guild.id))
      .limit(1)
    let currentWeekId: string
    let currentWeekStart: Date
    if (existingWeeks.length === 0) {
      const weekOne = new Date(now.getTime() - 12 * DAY)
      currentWeekStart = new Date(now.getTime() - 5 * DAY)
      await tx.insert(schema.guildWeeks).values({ guildId: guild.id, number: 1, startedAt: weekOne })
      const [week2] = await tx
        .insert(schema.guildWeeks)
        .values({ guildId: guild.id, number: 2, startedAt: currentWeekStart })
        .returning({ id: schema.guildWeeks.id })
      currentWeekId = week2!.id
    } else {
      const [latest] = await tx
        .select()
        .from(schema.guildWeeks)
        .where(eq(schema.guildWeeks.guildId, guild.id))
        .orderBy(desc(schema.guildWeeks.number))
        .limit(1)
      currentWeekId = latest!.id
      currentWeekStart = latest!.startedAt
    }

    // --- Members -----------------------------------------------------------
    type Member = { userId: string; mainId: string; name: string; combatPower: number; reliability: number }
    const members: Member[] = []

    const staffUserId = randomUUID()
    const staffMainId = randomUUID()
    await tx.insert(schema.users).values({
      id: staffUserId,
      guildId: guild.id,
      email: `mock-staff-${guild.slug}@guildmate.invalid`,
      supabaseUserId: randomUUID(),
      role: 'VICE_LEADER',
    })
    await tx.insert(schema.characters).values({
      id: staffMainId,
      userId: staffUserId,
      guildId: guild.id,
      name: 'Oraculo',
      nameNormalized: 'oraculo',
      race: 'CORA',
      biosuit: 'Psypher',
      level: 78,
      kind: 'MAIN',
      combatPower: 176_400,
      skill4: true,
      skill5: true,
      constant3: true,
    })

    for (const [index, name] of NAMES.entries()) {
      const userId = randomUUID()
      const mainId = randomUUID()
      // A spread that puts a handful above each ruler, like a real roster.
      const combatPower = Math.round(90_000 + random() ** 1.6 * 125_000)
      const level = 60 + Math.floor(random() * 21)

      await tx.insert(schema.users).values({
        id: userId,
        guildId: guild.id,
        email: `mock-${index + 1}-${guild.slug}@guildmate.invalid`,
        supabaseUserId: randomUUID(),
        role: 'MEMBER',
      })
      await tx.insert(schema.characters).values({
        id: mainId,
        userId,
        guildId: guild.id,
        name,
        nameNormalized: name.toLowerCase(),
        race: pick(['BELLATO', 'CORA', 'ACCRETIA'] as const),
        biosuit: pick(CLASSES),
        level,
        kind: 'MAIN',
        combatPower,
        skill4: level >= 62 || random() > 0.3,
        skill5: level >= 68 && random() > 0.3,
        skill6: level >= 74 && random() > 0.5,
        skill7: level >= 78 && random() > 0.6,
        constant3: random() > 0.4,
        painAdaptation: random() > 0.5,
        trinity: combatPower > 170_000 && random() > 0.4,
        techniqueMaster: combatPower > 185_000 && random() > 0.5,
      })

      if (random() < 0.35) {
        const altName = `${name}${pick(ALT_SUFFIX)}`
        await tx.insert(schema.characters).values({
          userId,
          guildId: guild.id,
          name: altName,
          nameNormalized: altName.toLowerCase(),
          race: pick(['BELLATO', 'CORA', 'ACCRETIA'] as const),
          biosuit: pick(CLASSES),
          level: 40 + Math.floor(random() * 25),
          kind: 'ALT',
          mainCharacterId: mainId,
          combatPower: Math.round(40_000 + random() * 50_000),
        })
      }

      members.push({ userId, mainId, name, combatPower, reliability: 0.35 + random() * 0.7 })
    }

    // --- Events and the points they paid ------------------------------------
    const eventNames = ['Guerra de Guilda', 'Raid de Guilda', 'Expedição', 'Defesa da Mina', 'Caçada ao Chefe', 'Escolta']
    const eventStarts = [
      ...Array.from({ length: 4 }, (_, i) => new Date(now.getTime() - 11 * DAY + i * 1.5 * DAY)),
      ...Array.from({ length: 6 }, (_, i) => new Date(currentWeekStart.getTime() + 2 * HOUR + i * 0.75 * DAY)),
    ].filter((at) => at.getTime() < now.getTime() - HOUR)

    for (const [index, startsAt] of eventStarts.entries()) {
      const code = generateEventCode()
      const pointsValue = pick([5, 10, 10, 15, 20])
      const [event] = await tx
        .insert(schema.events)
        .values({
          guildId: guild.id,
          name: `${eventNames[index % eventNames.length]} #${index + 1}`,
          pointsValue,
          status: 'CONFIRMED',
          codeHash: await hashEventCode(code),
          codeLookup: eventCodeLookup(code),
          codeHint: code.slice(-2),
          startsAt,
          registrationClosesAt: new Date(startsAt.getTime() + HOUR),
          confirmationDeadline: new Date(startsAt.getTime() + 48 * HOUR),
          minParticipants: 3,
          createdByUserId: staffUserId,
          confirmedAt: new Date(startsAt.getTime() + HOUR),
          createdAt: startsAt,
        })
        .returning({ id: schema.events.id })

      for (const member of members) {
        if (random() > member.reliability) continue
        await tx.insert(schema.eventRegistrations).values({
          eventId: event!.id,
          userId: member.userId,
          characterId: member.mainId,
          status: 'CONFIRMED',
          levelAtRegistration: 70,
          registeredAt: new Date(startsAt.getTime() + 10 * 60_000),
        })
        await tx.insert(schema.pointLedger).values({
          guildId: guild.id,
          userId: member.userId,
          characterId: member.mainId,
          kind: 'EVENT_AWARD',
          state: 'CONFIRMED',
          amount: pointsValue,
          reason: 'Mock event attendance',
          eventId: event!.id,
          createdByUserId: staffUserId,
          createdAt: startsAt,
          stateChangedAt: new Date(startsAt.getTime() + HOUR),
        })
      }
    }

    // --- Penalties and excused absences ---------------------------------------
    for (const member of members.slice(3, 6)) {
      await tx.insert(schema.pointLedger).values({
        guildId: guild.id,
        userId: member.userId,
        kind: 'PENALTY',
        state: 'CONFIRMED',
        amount: -pick([2, 5, 10]),
        reason: 'Ausente na guerra sem aviso',
        refType: 'penalty',
        createdByUserId: staffUserId,
      })
    }
    for (const member of members.slice(8, 10)) {
      await tx.insert(schema.attendanceExcuses).values({
        guildId: guild.id,
        weekId: currentWeekId,
        userId: member.userId,
        eventsExcused: 1,
        reason: 'Abono de Missão (Justificativa)',
        createdByUserId: staffUserId,
      })
    }

    // --- Loot: a past banner already drawn -----------------------------------
    const [pastBanner] = await tx
      .insert(schema.lootBanners)
      .values({
        guildId: guild.id,
        title: 'Espólios da Semana 1',
        status: 'CLOSED',
        closesAt: new Date(now.getTime() - 7 * DAY),
        closedAt: new Date(now.getTime() - 6 * DAY),
        createdByUserId: staffUserId,
        createdAt: new Date(now.getTime() - 9 * DAY),
      })
      .returning({ id: schema.lootBanners.id })

    const pastItems = ['Lâmina Relíquia +7', 'Núcleo de Biosuit Épico', 'Anel do Colosso']
    for (const [index, name] of pastItems.entries()) {
      const bettors = members.slice(index * 3, index * 3 + 3)
      const bets = bettors.map((m) => ({ id: randomUUID(), label: m.name, points: 5 + Math.floor(random() * 20), member: m }))
      const wheel = buildLootWheel({ bets, staffLabel: 'Oraculo', staffSharePct: 15 })
      const winner = bets[index % bets.length]!
      const drawnAt = new Date(now.getTime() - (8 - index) * DAY)

      const [lootItem] = await tx
        .insert(schema.lootItems)
        .values({
          bannerId: pastBanner!.id,
          guildId: guild.id,
          name,
          maxPoints: 50,
          status: 'DRAWN',
          winnerUserId: winner.member.userId,
          winnerCharacterId: winner.member.mainId,
          winnerName: winner.member.name,
          pointsPaid: winner.points,
          drawSlices: { slices: wheel, winnerIndex: wheel.findIndex((s) => s.betId === winner.id) },
          drawnAt,
          drawnByUserId: staffUserId,
        })
        .returning({ id: schema.lootItems.id })

      for (const bet of bets) {
        const won = bet.id === winner.id
        const [hold] = await tx
          .insert(schema.pointLedger)
          .values({
            guildId: guild.id,
            userId: bet.member.userId,
            characterId: bet.member.mainId,
            kind: 'LOOT_HOLD',
            state: 'CONFIRMED',
            amount: -bet.points,
            reason: `Loot bet: ${name}`,
            refType: 'loot_bet',
            refId: bet.id,
            createdAt: new Date(drawnAt.getTime() - DAY),
          })
          .returning({ id: schema.pointLedger.id })
        if (!won) {
          await tx.insert(schema.pointLedger).values({
            guildId: guild.id,
            userId: bet.member.userId,
            characterId: bet.member.mainId,
            kind: 'LOOT_RELEASE',
            state: 'CONFIRMED',
            amount: bet.points,
            reason: `Loot bet lost: ${name}`,
            refType: 'loot_bet',
            refId: bet.id,
            createdAt: drawnAt,
          })
        }
        await tx.insert(schema.lootBets).values({
          id: bet.id,
          itemId: lootItem!.id,
          guildId: guild.id,
          userId: bet.member.userId,
          characterId: bet.member.mainId,
          points: bet.points,
          holdLedgerId: hold!.id,
          status: won ? 'WON' : 'RELEASED',
          settledAt: drawnAt,
        })
      }
    }

    // --- Loot: the banner open right now -------------------------------------
    const [openBanner] = await tx
      .insert(schema.lootBanners)
      .values({
        guildId: guild.id,
        title: 'Espólios da Guerra de Sábado',
        closesAt: new Date(now.getTime() + 36 * HOUR),
        createdByUserId: staffUserId,
      })
      .returning({ id: schema.lootBanners.id })

    const openItems = [
      { name: 'Arma Lendária de Dano', maxPoints: 100, restriction: 'ALL' as const },
      { name: 'Escudo Relíquia', maxPoints: 80, restriction: 'TITAN' as const },
      { name: 'Asa Mítica', maxPoints: 150, restriction: 'MEGA' as const },
    ]
    for (const [index, spec] of openItems.entries()) {
      const [lootItem] = await tx
        .insert(schema.lootItems)
        .values({ bannerId: openBanner!.id, guildId: guild.id, ...spec })
        .returning({ id: schema.lootItems.id })

      // Only steady attendees bet, so no mock balance goes below zero.
      const eligible = members.filter((m) => m.reliability >= 0.75).filter((m) =>
        spec.restriction === 'MEGA' ? m.combatPower >= 190_000 : spec.restriction === 'TITAN' ? m.combatPower >= 155_000 : true,
      )
      for (const member of eligible.slice(index, index + 3)) {
        const betId = randomUUID()
        const points = 1 + Math.floor(random() * 8)
        const [hold] = await tx
          .insert(schema.pointLedger)
          .values({
            guildId: guild.id,
            userId: member.userId,
            characterId: member.mainId,
            kind: 'LOOT_HOLD',
            state: 'CONFIRMED',
            amount: -points,
            reason: `Loot bet: ${spec.name}`,
            refType: 'loot_bet',
            refId: betId,
          })
          .returning({ id: schema.pointLedger.id })
        await tx.insert(schema.lootBets).values({
          id: betId,
          itemId: lootItem!.id,
          guildId: guild.id,
          userId: member.userId,
          characterId: member.mainId,
          points,
          holdLedgerId: hold!.id,
        })
      }
    }

    // --- Meme raffle history -----------------------------------------------------
    const memeItems = ['Chapéu de Pato Dourado', 'Fantasia de Galinha', 'Poção de Cheiro Duvidoso', 'Bandeira do Clã Rival']
    for (const [index, itemName] of memeItems.entries()) {
      const winner = pick(members)
      await tx.insert(schema.memeDraws).values({
        guildId: guild.id,
        itemName,
        winnerCharacterId: winner.mainId,
        winnerName: winner.name,
        candidateCount: 8 + index,
        note: index === 0 ? 'Usou no mesmo dia na guerra' : null,
        drawnByUserId: staffUserId,
        createdAt: new Date(now.getTime() - (index + 1) * 2 * DAY),
      })
    }

    // --- Boss schedule -------------------------------------------------------------
    const groupIds: string[] = []
    for (const spec of BOSS_GROUPS) {
      const [group] = await tx
        .insert(schema.bossGroups)
        .values({
          guildId: guild.id,
          name: spec.name,
          respawnKind: spec.respawnKind,
          intervalHours: 'intervalHours' in spec ? spec.intervalHours : null,
          anchorAt: 'anchorInHours' in spec ? new Date(now.getTime() + (spec.anchorInHours ?? 0) * HOUR) : null,
          dailyTimes: 'dailyTimes' in spec ? spec.dailyTimes : null,
          weekdays: 'weekdays' in spec ? spec.weekdays : null,
        })
        .returning({ id: schema.bossGroups.id })
      groupIds.push(group!.id)
    }
    for (const [index, spec] of BOSSES.entries()) {
      await tx.insert(schema.bosses).values({
        guildId: guild.id,
        groupId: spec.group === null ? null : (groupIds[spec.group] ?? null),
        name: spec.name,
        location: spec.location,
        respawnKind: spec.group === null ? 'INTERVAL' : null,
        intervalHours: spec.group === null ? 36 : null,
        anchorAt: spec.group === null ? new Date(now.getTime() + 9 * HOUR) : null,
        inRotation: index % 4 !== 3,
      })
    }
  })

  console.info(`[seed-mock] done: ${NAMES.length + 1} mock members, events, loot, meme raffle and bosses`)
  process.exit(0)
}

main().catch((error) => {
  console.error('[seed-mock] failed', error)
  process.exit(1)
})
