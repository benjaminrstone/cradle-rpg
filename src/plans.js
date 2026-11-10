// Turn plans, one per kind of action (see Game.plan in engine.js).
import * as R from './rules.js';
import * as A from './arena.js';
import { fmt, pct } from './format.js';

const EPS = 1e-9;
const { STAR } = R;
// Each takes the game, the acting fighter and { key, t, amount, target, o, spd, tc } (t: the
// technique, o: the opponent, tc: the construct aimed at, if any).
export const TURN = { turn: true }; // a plan's queue entry for the fighter's next turn
const notEnough = { enabled: false, reason: 'Not enough madra', lines: [] };

export const PLANS = {
  // A strike chosen out of reach follows the opponent (unless told to walk elsewhere) and waits
  // to start until it would land in reach, as things stand; it gives up after chaseMax ticks.
  strike(g, f, { target, spd, tc }) {
    const prof = { ...g.attackProfile(f, 'strike'), target };
    const w = R.physTime(R.TIMING.strikeWindup, spd);
    if (!tc && !g.strikeLands(f, prof, w, g.time)) {
      const h = g.hypo;
      if (h.kept && !g.closingIn(h.walk)) h.walk = { hold: A.TOWARD_GAP };
      const at = g.strikeStart(f, prof, w);
      const giveUp = g.time + R.TIMING.chaseMax;
      const lands = at != null ? at + w : null;
      return {
        enabled: true, reason: '',
        warning: at == null ? `Out of reach, and not within reach in ${fmt(R.TIMING.chaseMax)} ticks as things stand: you'd give up at t=${fmt(giveUp)}` : null,
        lines: [
          at != null ? `Out of reach: closes in, and the strike starts t=${fmt(at)}, as soon as it would land in reach · lands t=${fmt(lands)} · next turn then` : `Out of reach: closes in, giving up at t=${fmt(giveUp)} if it never would land in reach`,
          g.attackLines(f, prof, prof.hits, null, R.RANGE_METRES[0]),
          'It starts on its own when it would land in reach, wherever they go; once started, backing off far enough makes it land short',
        ],
        nextTurn: lands ?? giveUp,
        queue: lands != null ? [{ time: lands, label: `${prof.name} lands`, type: 'attack' }, TURN] : [TURN],
        project: (p) => { if (at != null) p.hit(prof, prof.hits, R.RANGE_METRES[0]); },
        apply: () => {
          f.pending = { prof, w, delay: 0, giveUp };
          f.nextTurn = giveUp;
          g.addLog(`${f.name} closes in to strike.`, '', f.index);
        },
      };
    }
    const gate = tc ? g.constructGate(f, prof, tc) : g.rangeGate(f, prof, g.time + w);
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

  wait(g, f, { amount }) {
    const t = R.waitTime(amount);
    const arr = g.hypo.walk ? g.arrival(f, R.TIMING.waitMax) : null;
    return {
      enabled: true, reason: '', lines: [`Next turn in ${fmt(t)}`],
      nextTurn: g.time + t,
      arrival: arr,
      queue: arr != null && arr <= g.time + t + EPS ? [{ time: arr, label: 'arrives', type: 'move' }, TURN] : [TURN],
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

  // A straight flight that ends any walk.
  launch(g, f, { t, target, o }) {
    const plan = g.planMove(f, target, { reach: g.launchReach(t), flight: true });
    const enough = f.madra >= t.fixedCost;
    const head = `Costs ${t.fixedCost} madra · flies up to ${fmt(g.launchReach(t))} m in a straight line in ${fmt(t.travel)} ticks`;
    if (plan.error) return { enabled: false, reason: plan.error, lines: [head] };
    const land = g.time + t.travel;
    g.hypo.walk = null;
    g.hypo.flight = { start: g.time, end: land, from: { ...plan.from }, to: { x: plan.dest.x, y: plan.dest.y } };
    const gap = A.dist(plan.dest, g.pos(o, land));
    return {
      enabled: enough, reason: enough ? '' : 'Not enough madra',
      lines: [head,
        `To (${fmt(plan.dest.x)}, ${fmt(plan.dest.y)}): ${fmt(plan.length)} m · lands t=${fmt(land)} · next turn in ${fmt(t.travel + t.recovery)}`,
        `${o.name} will be ${fmt(gap)} m away (${R.RANGES[A.bandOf(gap)]})${o.walk || o.flight ? ' counting their course' : ''}`,
        'Ends your walk: you stand where you land'],
      cost: t.fixedCost,
      nextTurn: g.time + t.travel + t.recovery,
      queue: [{ time: land, label: `lands (${fmt(plan.length)} m)`, type: 'move' }, TURN],
      path: { who: f.index, from: plan.from, path: plan.path },
      apply: () => g.startFlight(f, plan, t.travel, t.name),
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
    const w = g.scaledWindup(f, t, madra);
    const gate = g.rangeGate(f, t, g.time + w);
    const targets = g.pulseTargets(o, madra, t.ranges);
    const lines = [
      `Wind-up ${fmt(w)} (lands t=${fmt(g.time + w)}) · next turn in ${fmt(w)}`,
      `Cancels ${o.name}'s wind-ups, stances, constructs and zones (ones you stand in) costing up to ${fmt(madra / 2)} · no roll`,
      targets.length ? `Right now: ${targets.map((x) => `${x.name} (${fmt(x.cost)})`).join(', ')}` : `Nothing of ${o.name}'s is that cheap right now`,
      `${o.name} can block it: each madra takes 1.5 off its strength`,
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
    const bands = R.reachText(g.specOf(t));
    const gate = g.rangeGate(f, t, g.time + w);
    const prof = g.disruptProfile(f, t);
    const lines = [`Costs ${t.fixedCost} madra · wind-up ${fmt(w)} (lands t=${fmt(g.time + w)}) · next turn in ${fmt(w)}`];
    lines.push(t.area
      ? `Breaks ${o.name}'s wind-ups, stances${t.destroysConstructs ? ' and constructs' : ''} within ${bands} · no roll`
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
        `Star forms at t=${fmt(g.time + w)} (${fmt(w)} ticks) · next turn in ${fmt(R.TIMING.actWhileBuilding)} (keep acting while it forms)`,
        `When dropped: ${fmt(sp.damage)} spiritual (${g.hitResult(f, o, sp).dmg} after ${o.name}'s reduction) · star HP ${fmt(madra * (t.sizeMult || 1))}, high overhead`,
      ],
      cost: s.cost,
      nextTurn: g.time + R.TIMING.actWhileBuilding,
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
      if (err) return { enabled: false, reason: err, lines: [timing, prof.shape === 'line' ? `A beam up to ${fmt(prof.length)} m long; pick its direction on the field` : `Radius ${fmt(prof.radius)} m; pick its centre on the field`] };
      const gate = g.areaGate(f, prof, g.time + w);
      const z = prof.zone;
      const pulses = z ? Math.floor(z.duration / z.every + 1e-9) + 1 : 0;
      const pulseProf = z ? { ...prof, damage: (prof.damage * R.ZONE_TOTAL) / pulses } : null;
      const lines = [timing, g.areaLine(f, prof), z
        ? `Stays ${fmt(z.duration)} ticks, pulsing ${pulses} times${pulseProf.damage > 0.05 ? `: ${fmt(pulseProf.damage)} damage each (${g.hitResult(f, o, pulseProf).dmg} after ${o.name}'s reduction)` : ''}${z.slow ? ` · Speed −${pct(z.slow)} inside` : ''}`
        : g.attackLines(f, prof, g.hitsAgainst(f, o, prof))];
      if (gate.note) lines.push(gate.note);
      return {
        enabled: true, reason: '', warning: gate.warning, lines: [...lines, ...notes],
        cost, nextTurn, queue,
        project: (p) => {
          const l = g.areaLands(f, prof, g.time + w);
          p.out.area = { who: f.index, shape: l.shape, zone: !!z };
          if (l.ok && z) {
            if (pulseProf.damage > 0.05) p.add(o.index, g.hitResult(f, o, pulseProf).track, -g.hitResult(f, o, pulseProf).dmg);
            p.out.notes[o.index] = `per pulse while inside${z.slow ? `, Speed −${pct(z.slow)}` : ''}`;
          } else if (l.ok) {
            const hits = g.hitsAgainst(f, o, prof);
            const res = g.hitResult(f, o, prof);
            p.add(o.index, res.track, -res.dmg * hits);
            p.out.notes[o.index] = `${hits > 1 ? `${hits} hits, ` : ''}no roll`;
          } else p.out.notes[o.index] = `missed: ${l.why}`;
        },
        apply: () => {
          const r = `radius ${fmt(prof.radius)} m`;
          start(prof.shape === 'line' ? ` toward (${fmt(prof.end.x)}, ${fmt(prof.end.y)}), a ${fmt(A.dist(prof.origin, prof.end))} m beam`
            : prof.aim === 'set' ? ` at (${fmt(prof.centre.x)}, ${fmt(prof.centre.y)}), ${r}` : `, reaching ${fmt(prof.radius)} m around them`);
        },
      };
    }
    const gate = tc ? g.constructGate(f, prof, tc) : g.rangeGate(f, prof, g.time + w);
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
  const w = g.scaledWindup(f, t, madra);
  const next = t.ruler ? R.TIMING.actWhileBuilding : w;
  const timing = `${t.costMult ? `Costs ${fmt(madra * t.costMult)} madra · ` : ''}Wind-up ${fmt(w)} (lands t=${fmt(g.time + w)}) · next turn in ${fmt(next)}${t.ruler ? ' (Ruler: act while it builds)' : ''}`;
  return { madra, w, cost: madra * (t.costMult || 1), timing };
}
