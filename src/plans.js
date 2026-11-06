// Turn plans: one per kind of action. Each works out everything about a turn choice once
// (see Game.plan in engine.js): the preview, the cost, when the fighter acts next, the ghost
// queue items, the expected effect on the bars, and what it starts when chosen.
import * as R from './rules.js';
import { fmt, pct } from './format.js';

const EPS = 1e-9;
const { STAR } = R;
// Each takes the game, the acting fighter and { key, t, amount, target, o, spd, tc } (t: the
// technique, o: the opponent, spd: the fighter's Speed, tc: the construct aimed at, if any) and
// returns a plan as described at Game.plan.
export const TURN = { turn: true }; // a plan's queue entry for the fighter's next turn
const notEnough = { enabled: false, reason: 'Not enough madra', lines: [] };

export const PLANS = {
  strike(g, f, { target, spd, tc }) {
    const prof = { ...g.attackProfile(f, 'strike'), target };
    const w = R.physTime(R.TIMING.strikeWindup, spd);
    const gate = tc ? g.constructGate(f, [0], tc, 'Close range only') : g.rangeGate(f, [0], g.time + w, 'Close range only');
    const lines = [`Wind-up ${fmt(w)} · next turn in ${fmt(w)}`, g.attackLines(f, prof, prof.hits, tc)];
    if (gate.note) lines.push(gate.note);
    return {
      enabled: true, reason: '', warning: gate.warning, lines,
      nextTurn: g.time + w,
      queue: [{ time: g.time + w, label: `${prof.name} lands`, type: 'attack' }, TURN],
      project: (p) => p.hit(prof, prof.hits),
      apply: () => {
        g.startWindup(f, w, { kind: 'attack', profile: prof }, 0);
        g.addLog(`${f.name} winds up a strike${g.aimedAt(f, target)}.`, '', f.index);
      },
    };
  },

  move(g, f, { target, spd }) {
    const plan = g.planMove(f, target);
    if (plan.error) return { enabled: false, reason: plan.error, lines: [`${fmt(R.TIMING.moveRate * (spd / 100) ** 2)} m per tick at your Speed, around obstacles`] };
    const w = R.moveTime(plan.length, spd);
    return {
      enabled: true, reason: '', lines: g.moveLines(f, plan, w, w),
      nextTurn: g.time + w,
      queue: [{ time: g.time + w, label: `arrives (${fmt(plan.length)} m)`, type: 'move' }, TURN],
      path: { who: f.index, from: plan.from, path: plan.path },
      apply: () => g.startMove(f, plan, w),
    };
  },

  wait(g, f, { amount }) {
    const t = R.waitTime(amount);
    return {
      enabled: true, reason: '', lines: [`Next turn in ${fmt(t)}`],
      nextTurn: g.time + t,
      queue: [TURN],
      apply: () => g.addLog(`${f.name} waits ${fmt(t)} ticks.`, 'dim', f.index),
    };
  },

  drop(g, f, { key }) {
    const def = g.tech(f, key.slice(5));
    return {
      enabled: true, reason: '', free: true,
      lines: [`Free. Can be raised again after ${fmt(g.reraiseDelay(f))} ticks${def.buildUp ? '; build-up is lost' : ''}`],
      apply: () => {
        g.dropStance(f, def.id);
        g.addLog(`${f.name} drops ${def.name}.`, '', f.index);
      },
    };
  },

  stance(g, f, { t }) {
    const locked = f.lockedUntil[t.id] && f.lockedUntil[t.id] > g.time + EPS;
    const w = g.twind(t, R.TIMING.stanceWindup, f.stats.control);
    const enough = f.madra >= t.raiseCost;
    return {
      enabled: !locked && enough,
      reason: locked ? `Can be raised again at t=${fmt(f.lockedUntil[t.id])}` : !enough ? 'Not enough madra' : '',
      lines: [
        `Costs ${t.raiseCost} madra · wind-up ${fmt(w)} · next turn in ${fmt(w)}`,
        `Upkeep ${fmt(t.upkeep * R.controlFactor(f.stats.control))} madra per tick${t.buildUp ? ', rising with build-up' : ''}`,
      ],
      cost: t.raiseCost,
      nextTurn: g.time + w,
      queue: [{ time: g.time + w, label: `${t.name} is up`, type: 'stance' }, TURN],
      apply: () => {
        g.startWindup(f, w, { kind: 'stance', id: t.id }, t.raiseCost);
        g.addLog(`${f.name} begins raising ${t.name} (${t.raiseCost} madra).`, '', f.index);
      },
    };
  },

  launch(g, f, { t, target }) {
    const plan = g.planMove(f, target, { reach: g.launchReach(t), flight: true });
    const enough = f.madra >= t.fixedCost;
    const head = `Costs ${t.fixedCost} madra · flies up to ${fmt(g.launchReach(t))} m in a straight line in ${fmt(t.travel)} ticks`;
    if (plan.error) return { enabled: false, reason: plan.error, lines: [head] };
    return {
      enabled: enough, reason: enough ? '' : 'Not enough madra',
      lines: [head, ...g.moveLines(f, plan, t.travel, t.travel + t.recovery)],
      cost: t.fixedCost,
      nextTurn: g.time + t.travel + t.recovery,
      queue: [{ time: g.time + t.travel, label: `lands (${fmt(plan.length)} m)`, type: 'move' }, TURN],
      path: { who: f.index, from: plan.from, path: plan.path },
      apply: () => g.startMove(f, plan, t.travel, t.name),
    };
  },

  // Dropping Crown stars: biggest first, as one attack with a hit per star.
  command(g, f, { amount, o }) {
    const stars = g.stars(f).sort((a, b) => b.madra - a.madra);
    if (!stars.length) return { enabled: false, reason: 'No stars forged', lines: [] };
    const n = Math.min(Math.max(1, Math.round(amount) || stars.length), stars.length);
    const chosen = stars.slice(0, n);
    const after = chosen.map((c) => g.hitResult(f, o, g.starProfile(f, c.madra)).dmg);
    const chance = g.hitChance(f, o, g.starProfile(f, chosen[0].madra));
    const land = g.time + STAR.dropTime;
    return {
      enabled: true, reason: '',
      lines: [
        `Drops ${n} of ${stars.length} star(s), biggest first · they land t=${fmt(land)} · next turn then`,
        `${chosen.map((c) => c.madra).join(' + ')} madra: ${after.join(' + ')} spirit damage after reduction · ${pct(chance)} to hit each`,
      ],
      nextTurn: land,
      queue: [{ time: land, label: `${n} star(s) land`, type: 'attack' }, TURN],
      project: (p) => {
        for (const d of after) p.add(o.index, 'spirit', -d);
        p.out.notes[o.index] = 'if every star hits';
      },
      apply: () => {
        f.constructs = f.constructs.filter((c) => !chosen.includes(c));
        const profile = { ...g.starsProfile(f, chosen.map((c) => c.madra)), target: '' };
        g.events.push({ id: g.nextId++, time: land, type: 'resolve', actor: f.index, action: { kind: 'attack', profile } });
        g.addLog(`${f.name} drops ${n} star${n > 1 ? 's' : ''} from the Crown (${chosen.map((c) => c.madra).join(', ')} madra; landing t=${fmt(land)}).`, '', f.index);
      },
    };
  },

  pulse(g, f, { t, amount, o }) {
    if (g.maxMadra(f, t) < t.minMadra) return notEnough;
    const madra = g.madraFor(f, t, amount);
    const w = g.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
    const gate = g.rangeGate(f, t.ranges, g.time + w, 'Out of range (Close)');
    const targets = g.pulseTargets(o, madra, t.ranges);
    const lines = [
      `Wind-up ${fmt(w)} (lands t=${fmt(g.time + w)}) · next turn in ${fmt(w)}`,
      `Cancels ${o.name}'s wind-ups, stances and constructs costing up to ${fmt(madra / 2)} · no roll`,
      targets.length ? `Right now: ${targets.map((x) => `${x.name} (${fmt(x.cost)})`).join(', ')}` : `Nothing of ${o.name}'s is that cheap right now`,
      `${o.name} can block it at double cost: each point takes 1.5 off its strength`,
    ];
    if (gate.note) lines.push(gate.note);
    return {
      enabled: true, reason: '', warning: gate.warning, lines,
      cost: madra,
      nextTurn: g.time + w,
      queue: [{ time: g.time + w, label: `${t.name} lands`, type: 'attack' }, TURN],
      project: (p) => {
        p.out.notes[o.index] = targets.length ? `unless blocked: ${targets.map((x) => x.name).join(', ')} break` : 'nothing cheap enough to break';
      },
      apply: () => {
        g.startWindup(f, w, { kind: 'pulse', id: t.id, profile: g.pulseProfile(f, t, madra) }, madra);
        g.addLog(`${f.name} winds up ${t.name} with ${madra} madra (lands t=${fmt(g.time + w)}).`, '', f.index);
      },
    };
  },

  disrupt(g, f, { t, o }) {
    const enough = f.madra >= t.fixedCost;
    const w = g.twind(t, t.windup, f.stats.control);
    const bands = t.ranges.map((r) => R.RANGES[r]).join('/');
    const gate = g.rangeGate(f, t.ranges, g.time + w, `Out of range (${bands})`);
    const prof = g.disruptProfile(f, t);
    const lines = [`Costs ${t.fixedCost} madra · wind-up ${fmt(w)} (lands t=${fmt(g.time + w)}) · next turn in ${fmt(w)}`];
    lines.push(t.area
      ? `Breaks ${o.name}'s wind-ups, stances${t.destroysConstructs ? ' and constructs' : ''} at ${bands} range · no roll`
      : `If it hits, breaks ${o.name}'s wind-ups and stances · ${g.hitText(f, o, prof)}`);
    if (gate.note) lines.push(gate.note);
    return {
      enabled: enough, reason: enough ? '' : 'Not enough madra', warning: gate.warning, lines,
      cost: t.fixedCost,
      nextTurn: g.time + w,
      queue: [{ time: g.time + w, label: `${t.name} lands`, type: 'attack' }, TURN],
      project: (p) => { p.out.notes[o.index] = t.area ? 'wind-ups, stances and constructs break' : 'if it hits: wind-ups and stances break'; },
      apply: () => {
        g.startWindup(f, w, { kind: 'disrupt', id: t.id, profile: prof }, t.fixedCost);
        g.addLog(`${f.name} winds up ${t.name} (lands t=${fmt(g.time + w)}).`, '', f.index);
      },
    };
  },

  // A ring construct Forged on yourself (Oathsign: Accelerate).
  ring(g, f, { t }) {
    const enough = f.madra >= t.fixedCost;
    const w = g.twind(t, t.windup, f.stats.control);
    const n = g.rings(f).length;
    const strike = g.attackProfile(f, 'strike').damage;
    return {
      enabled: enough, reason: enough ? '' : 'Not enough madra',
      lines: [
        `Costs ${t.fixedCost} madra · ring forms at t=${fmt(g.time + w)} · next turn then`,
        `Speed ${fmt(g.speed(f))} → ${fmt(g.speed(f, t.speedBonus))}, melee damage +${t.meleeBonus} (strike ${fmt(strike)} → ${fmt(strike + t.meleeBonus)})${n ? ` · ${n + 1} rings` : ''}`,
        `Ring HP ${t.fixedCost}, on you: it can be targeted, and area attacks hit it`,
      ],
      cost: t.fixedCost,
      nextTurn: g.time + w,
      queue: [{ time: g.time + w, label: `${t.ringName} forms`, type: 'construct' }, TURN],
      project: (p) => { p.out.notes[f.index] = `+${t.speedBonus} Speed and +${t.meleeBonus} melee damage once it forms`; },
      apply: () => {
        g.startWindup(f, w, { kind: 'ring', id: t.id }, t.fixedCost, { label: t.ringName });
        g.addLog(`${f.name} begins Forging an ${t.ringName} (${t.fixedCost} madra; forms t=${fmt(g.time + w)}).`, '', f.index);
      },
    };
  },

  // Forging one Crown star: it forms over its wind-up while you keep acting.
  forge(g, f, ctx) {
    const s = scaled(g, f, ctx);
    if (!s) return notEnough;
    const { t, o } = ctx;
    const { madra, w } = s;
    const sp = g.starProfile(f, madra);
    return {
      enabled: true, reason: '',
      lines: [
        `Star forms at t=${fmt(g.time + w)} (${fmt(w)} ticks) · next turn in ${fmt(STAR.forgeRecovery)} (keep acting while it forms)`,
        `When dropped: ${fmt(sp.damage)} spiritual (${g.hitResult(f, o, sp).dmg} after ${o.name}'s reduction) · star HP ${fmt(madra * (t.sizeMult || 1))}, high overhead (Far)`,
      ],
      cost: s.cost,
      nextTurn: g.time + STAR.forgeRecovery,
      queue: [TURN, { time: g.time + w, label: `star (${madra}) forms`, type: 'construct' }],
      apply: () => {
        g.startWindup(f, w, { kind: 'forged', id: t.id, madra }, madra, { label: `Crown star (${madra})` });
        g.addLog(`${f.name} begins Forging a ${madra}-madra star (forms t=${fmt(g.time + w)}).`, '', f.index);
      },
    };
  },

  // A Forged barrier: it builds piece by piece while you keep acting.
  construct(g, f, ctx) {
    const s = scaled(g, f, ctx);
    if (!s) return notEnough;
    const { t } = ctx;
    const { madra, w } = s;
    const pieces = g.forgePieces(t, madra);
    const barrier = g.barrier(f);
    return {
      enabled: true, reason: '',
      lines: [
        `Builds over ${fmt(w)} ticks, one piece every ${fmt(w / pieces.length)} · next turn in ${fmt(R.TIMING.actWhileBuilding)} (Forger: act while it builds)`,
        `Barrier HP +${fmt(madra * 2 * (t.sizeMult || 1))}${barrier ? ` (now ${fmt(barrier.hp)})` : ''}, filling in as it builds`,
      ],
      cost: s.cost,
      nextTurn: g.time + R.TIMING.actWhileBuilding,
      queue: [TURN, ...pieces.map((pc, i) => ({ time: g.time + w * ((i + 1) / pieces.length), label: `barrier piece ${i + 1}/${pieces.length} forms`, type: 'construct' }))],
      apply: () => {
        g.startForge(f, t, w, madra);
        g.addLog(`${f.name} begins Forging ${t.name} with ${madra} madra (complete at t=${fmt(g.time + w)}).`, '', f.index);
      },
    };
  },

  // A damaging technique: single-target (rolled) or an area (no roll).
  attack(g, f, ctx) {
    const s = scaled(g, f, ctx);
    if (!s) return notEnough;
    const { key, t, target, o, tc } = ctx;
    const { madra, w, cost, timing } = s;
    const prof = { ...g.attackProfile(f, key, madra), target };
    const nextTurn = g.time + (t.ruler ? R.TIMING.actWhileBuilding : w);
    const queue = [TURN, { time: g.time + w, label: `${t.name} lands`, type: 'attack' }];
    const notes = g.attackNotes(f, t, prof, madra);
    const start = (aimedText) => {
      g.startWindup(f, w, { kind: 'attack', profile: prof }, cost, { boostPerMadra: t.boostPerMadra || 0 });
      g.addLog(`${f.name} winds up ${t.name} with ${madra} madra${aimedText} (lands t=${fmt(g.time + w)}).`, '', f.index);
    };
    if (prof.area) {
      const err = g.aimArea(f, prof, target);
      if (err) return { enabled: false, reason: err, lines: [timing, `Radius ${fmt(prof.radius)} m; pick its centre on the field`] };
      const gate = g.areaGate(f, prof, g.time + w);
      const ac = prof.aimAt ? tc : null;
      const lines = [timing, g.areaLine(f, prof), ac ? `${g.constructDamage(prof)} damage to ${ac.name}` : g.attackLines(f, prof, g.hitsAgainst(f, o, prof), tc)];
      if (gate.note) lines.push(gate.note);
      return {
        enabled: true, reason: '', warning: gate.warning, lines: [...lines, ...notes],
        cost, nextTurn, queue,
        project: (p) => {
          const l = g.areaLands(f, prof, g.time + w);
          if (l.centre) p.out.area = { who: f.index, centre: l.centre, radius: prof.radius };
          if (prof.aimAt) p.out.notes[o.index] = 'aimed at a construct';
          else if (l.ok) {
            const hits = g.hitsAgainst(f, o, prof);
            const res = g.hitResult(f, o, prof);
            p.add(o.index, res.track, -res.dmg * hits);
            p.out.notes[o.index] = `${hits > 1 ? `${hits} hits, ` : ''}no roll`;
          } else p.out.notes[o.index] = `missed: ${l.why}`;
        },
        apply: () => {
          const r = `radius ${fmt(prof.radius)} m`;
          start(prof.aim === 'set' ? ` at (${fmt(prof.centre.x)}, ${fmt(prof.centre.y)}), ${r}`
            : prof.aim === 'release' ? `${g.aimedAt(f, target) || ` at ${o.name}`}, ${r}`
              : `, reaching ${fmt(prof.radius)} m around them`);
        },
      };
    }
    const rangeText = `Out of range (${prof.ranges.map((r) => R.RANGES[r]).join('/')})`;
    const gate = tc ? g.constructGate(f, prof.ranges, tc, rangeText) : g.rangeGate(f, prof.ranges, g.time + w, rangeText);
    const lines = [timing, g.attackLines(f, prof, tc ? 1 : g.hitsAgainst(f, o, prof), tc)];
    if (gate.note) lines.push(gate.note);
    return {
      enabled: true, reason: '', warning: gate.warning, lines: [...lines, ...notes],
      cost, nextTurn, queue,
      project: (p) => p.hit(prof, g.hitsAgainst(f, o, prof)),
      apply: () => start(g.aimedAt(f, target)),
    };
  },
};

// The shared part of techniques that scale with madra (stars, barriers, attacks): the madra
// used, its wind-up, what it costs, and the timing line. Null if there isn't enough madra.
function scaled(g, f, { t, amount }) {
  if (g.maxMadra(f, t) < (t.minMadra || 1)) return null;
  const madra = g.madraFor(f, t, amount);
  const w = g.twind(t, R.nominalWindup(madra, t.divisor), f.stats.control);
  const next = t.ruler ? R.TIMING.actWhileBuilding : w;
  const timing = `${t.costMult ? `Costs ${fmt(madra * t.costMult)} madra · ` : ''}Wind-up ${fmt(w)} (lands t=${fmt(g.time + w)}) · next turn in ${fmt(next)}${t.ruler ? ' (Ruler: act while it builds)' : ''}`;
  return { madra, w, cost: madra * (t.costMult || 1), timing };
}
