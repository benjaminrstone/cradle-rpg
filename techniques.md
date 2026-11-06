# Techniques

Numbers are for a typical fighter in units of their own stage (see stats.md): Health 100, Toughness 3, Channel cap 15, Control 5.

## Shared rules

- **Wind-up** is the time until a technique lands. It's public and can be interrupted. Control shortens it by 3% per point.
- **Strikes can't be broken.** A plain strike has no madra to disrupt, so interrupts and Madra Pulse don't stop it. A broken enforced strike loses its madra like any wind-up, but still lands as a plain strike at the same time.
- **No recovery:** your next turn comes as soon as your action lands.
- **Scaling techniques:** for most techniques, you choose how much madra to put in, up to your channel cap (Ruler techniques have no cap). Wind-up = madra ÷ 3 (minimum 1); Striker techniques are faster at madra ÷ 4, and Ruler techniques slower at madra ÷ 2. A small, fast shot and a slow, heavy blast are the same technique. Stances have a fixed cost.
- **Damage = madra × efficiency.** Efficiency = 1.2 + 0.1 × the longer of (madra ÷ 3) and the wind-up, up to 2.2. Bigger techniques get more damage per madra, and techniques slower than madra ÷ 3 get a little extra for it.
- **Techniques that build while you act:** Ruler techniques, Forged barriers and Crown stars have long wind-ups, but your next turn comes 1.5 ticks after you start, so you keep acting while they build.
- **Several wind-ups at once:** a fighter can have more than one technique winding up. A hit over their threshold breaks all of them.
- **Stances break too,** but take twice the threshold. A hit that big drops every stance you hold.
- **To-hit:** fast, precise techniques get +1 or +2. Heavy, slow ones get −1.
- **Some techniques cost extra madra per point of power** (Endless Sword costs 1.5). Their damage and wind-up follow the power; the channel cap limits the madra actually spent.
- **Reach and best distance:** each attack has a reach and a best distance in metres, and takes −1 to hit for every 4 m past its best. Close, Mid and Far are shorthand for 2, 10 and 20 m: "Close only" reaches 2 m; "any range, best at Mid" reaches anywhere and is accurate within 10 m (battlefield.md).
- **Range counts when an attack lands.** You can start any attack at any distance, including one that will reach only because someone moves first. The line from attacker to target must also be clear of obstacles when it lands. One that won't reach is shown with a warning and is wasted if the distance doesn't change.
- **Area attacks don't roll** and deal 0.75× damage for it. They hit everything inside a circle (around the attacker or set at a point; a blast needs a clear line from its centre, while one that fills its area reaches behind cover too) or along a line (a beam from the attacker toward a point); their size grows with madra (battlefield.md). The defender can block, sidestep out of it (a dodge), or be outside it when it lands.
- **Zones** are areas that stay where they formed for some ticks, pulsing damage and/or slowing whoever is inside; their pulses can't be dodged or blocked, only left (battlefield.md).
- **Damage types:** physical (strikes and weapon blows), technique (most techniques), and spiritual. Spiritual damage goes to the spirit track instead of health, is reduced by Spirit ÷ 10 instead of Toughness, passes through barriers, counts double against interrupt and stance thresholds, and does double damage to constructs.
- **Disruption** breaks a target's wind-ups and stances without doing damage. Area disruption also disperses their constructs.
- **Unique effects come out of the damage budget.** For example, ignoring damage reduction costs about 1 damage per point ignored.
- **Damage reduction applies to every hit,** including Ruler aura pulses. Resistance to one element doesn't help against another.
- **Upkeep:** held techniques cost madra over time. Control reduces upkeep by 5% per point and shortens the delay before a dropped technique can be raised again by 5% per point.
- **Forged constructs have no upkeep.** Their limits are their HP and the madra and time they cost to make.
- **Forging doesn't tie you up.** Starting a construct is quick: your next turn comes soon, and the construct forms over its wind-up while you keep acting. Some constructs build piece by piece (a barrier fills in 5 madra at a time); others are many small constructs Forged one at a time (each Crown star). Interrupting a build stops the unformed part; anything already formed stays.
- **Constructs can have their own commands.** A technique can have several uses on one card, such as forging stars and dropping them.
- **Attacking constructs:** a single-target attack can be aimed at an opponent's construct instead of the opponent. It rolls against a flat Defense of 10, with the range penalty counted from where the construct is. Constructs can't dodge, but the owner can reinforce one with madra like a block (soaks 1.5 per madra, next turn 1 tick later). Area attacks hit every construct inside them automatically. A construct sits on its owner unless it says otherwise; Crown stars hang 14 m over their owner, above every obstacle. Constructs take no damage reduction, and spiritual hits do double damage to them. Barriers are the exception: they can't be targeted, and instead soak what gets through their owner's reduction.

## Templates

Everyone can strike, dodge, block, move, and wait. The rest come from a fighter's Path.

- **Move:** walk to any spot on the arena, around obstacles, at 2 m per tick at Speed 100 (time scales by (100 / Speed)², minimum 0.5 ticks). You are partway along the route while you move, so attacks that land mid-move are aimed at where you are then (battlefield.md).
- **Wait:** pass for as many ticks as you choose.

| Template | Type | Role | Madra | Wind-up | Damage | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Strike | Physical | Press | 0 | 2 × (100 / Speed)² | 10 | Close range only |
| Empowered strike | Enforcer | Press to Build, by madra | Any, up to channel cap | Madra ÷ 3 | 10 + madra × efficiency: 6 madra → 18, 10 → 25, 15 → 36 | Close range only |
| Striker technique | Striker | Press to Build, by madra | Any, up to channel cap | Madra ÷ 4 | 6 madra → 8, 10 → 15, 15 → 26 | Any range; best at Mid |
| Guard stance | Enforcer | Guard | 4 to raise | 1 | | +6 damage reduction. Upkeep 1 madra per 2 ticks. 4-tick delay before it can be raised again |
| Swift stance | Enforcer | Movement | 4 to raise | 1 | | +25% Speed. Upkeep 1 madra per 2 ticks |
| Block | Anyone, reaction | Guard | Any, up to channel cap | Instant | | Soaks 1.5 damage per madra, in all, shared by the attack's hits, after damage reduction. Pushes your next action 1 tick later |
| Forged star | Forger | Build | Any, up to channel cap | Madra ÷ 3 | Madra × ⅔ per attack, every 5 ticks: 15 madra → 10 | HP = madra |
| Aura field | Ruler | Build | Any, up to channel cap | Madra ÷ 2 | 5 pulses of madra × 0.6, one every 4 ticks: 20 madra → 12 | No roll. Avoided by leaving the zone. Can trade the damage for a field effect of similar value that scales the same way, like −25% enemy Speed at 20 madra |

## How the templates play against each other

- **Press interrupts Build.** Interrupting takes 8 damage after reduction at Control 5: a 1-madra empowered strike or an 8-madra Striker shot does it. A plain strike (7) doesn't.
- **Guard shrugs off Press.** With Guard stance up, damage reduction is 9, and small shots and strikes do nothing.
- **Build overwhelms Guard.** A full 15-madra Striker shot lands 17 through Guard stance. A block soaks 1.5 per madra while the shot made 1.7 damage per madra, so blocking a Build loses the madra trade; it's for keeping a hit under your threshold, or surviving.
- **Forgers snowball.** A 15-madra star pays back its cost in about 15–20 ticks. Two strikes or one spiritual hit destroy it. Small constructs barely get through damage reduction, so constructs are worth making at a decent size.
- **The budget runs out.** Six or seven full Striker shots empty the pool. Guard upkeep across a fight costs about 25 madra.

## Building a technique set

A fighter's techniques come out of the same point budget as their stats (see stats.md).

- **Each Path has three core techniques, and they're free.** Its other techniques cost 1 point for a utility and 2 for a major technique; paths.md lists which is which.
- **A general library** holds techniques any Path can learn, priced the same way.
- **Refinements** tune one technique a step at a time. Each step up costs 1 point, at most 3 per technique; each step down refunds 1 point, at most 2 per technique.

| Refinement | Step up | Step down |
| --- | --- | --- |
| Accuracy | +1 to hit | −1 to hit |
| Power | +0.1 efficiency | −0.1 efficiency |
| Quickness | −10% wind-up | +10% wind-up |
| Reach | Best range one band further | Best range one band shorter |
| Economy (stances) | −20% raise cost and upkeep | +20% raise cost and upkeep |
| Size (constructs) | +25% HP | −25% HP |

- **A Path's madra traits aren't for sale.** Pure madra, sharpness and Black Flame's efficiency come with the Path, so they stay what makes each Path distinct.

