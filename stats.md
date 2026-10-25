# Statistics

Nine stats in three groups: Body, Spirit, and Mind. Stage multiplies Body and Spirit, never Mind.

| Group | Stat | What it does in a fight | Who wants it |
| --- | --- | --- | --- |
| **Body** | Health | Health track | Everyone |
| | Toughness | Flat damage reduction against physical hits | Guard, Enforcers |
| | Speed | Movement, physical attacks and dodges, how far physical actions push you down the queue, how hard you are to hit | Press, movement |
| **Spirit** | Madra pool | Total budget | Forgers, long fights |
| | Channel cap | Most madra per action (Ruler techniques aren't limited by it) | Build, Strikers |
| | Spirit | Spirit track, and damage reduction against spiritual hits | Spirit specialists, anyone facing them |
| **Mind** | Precision | Attack roll bonus | Strikers, Press |
| | Control | Technique speed, upkeep cost, delay before a dropped technique can be raised again, interrupt threshold | Build, Enforcer stances, Forgers |
| | Perception | How much you see or notice: reading wind-ups, scouting, how hard you are to hit | Rulers, reactive fighters |

## How the stats fit the fight

- **The triangle:** Press wants Speed and Precision. Build wants Channel cap and Control. Guard wants Toughness and Madra pool.
- **Being hard to hit** comes from both Speed and Perception.
- **Interrupts:** the threshold comes from Control: how firmly you hold a technique together. Spiritual hits count extra against it. Traits like an iron body can raise it.
- **Speed:** physical speed is a Body stat and scales with stage. Technique speed comes from Control and doesn't.
- **Perception:** a fighter with higher Perception sees more of a wind-up and notices more about an opponent than one with lower Perception.
- **Madra regeneration** isn't a stat.

## Where build expression comes from

- **Iron bodies** change Body stats and add traits.
- **Cores and madra elements** shape Spirit and decide which techniques you can use.
- **Paths** decide your techniques.
- **Training and insight** raise Mind.
- **Weapons and artifacts** add to physical damage and can carry their own effects.

## Numbers and scaling

Body and Spirit stats are big numbers that scale with stage. Mind stats run 0–10 (typical fighters have 3–6; 10 is a master) and never scale. Where the two meet, use ratios or percentages, so a point of Mind is worth the same at every stage.

### Stage multiplier

Each stage multiplies Body and Spirit stats:

- ×1.5 per stage within a realm.
- ×2 crossing into a new realm: Jade → Lowgold, Truegold → Underlord.
- Soulfire arrives at Underlord and is a big boost on top of that.

Realms: Foundation to Jade, Lowgold to Truegold, Underlord to Archlord.

### A typical fighter, in units of their own stage

| Stat | Typical value |
| --- | --- |
| Health | 100 |
| Toughness | 3 |
| Speed | 100 |
| Madra pool | 100 |
| Channel cap | 15 |
| Spirit | 50 |
| Precision, Control, Perception | 3–6 each |

### Building a fighter

Fighters are built with points. Every stat starts at the typical value for the stage, worth 0 points, and moves in steps:

| Stat | One step |
| --- | --- |
| Health | ±10 |
| Toughness | ±1 |
| Speed | ±5% |
| Madra pool | ±15 |
| Channel cap | ±2 |
| Spirit | ±10 |
| Precision, Control, Perception | ±1 |

Body and Spirit steps are fractions of the stage's typical value, so they scale when a fighter advances; Mind steps are flat.

- **Each step up costs 1 point,** with no limit per stat.
- **Each step down pays back 1 point,** down to −3 per stat.
- **A named fighter has 6 points to spend,** plus whatever their weaknesses pay back.
- **Each Path grants its signature stat's first step free:** madra pool for the Hollow King, Precision for the Endless Sword, Toughness for the Dawn Oath, channel cap for Black Flame.
- **Traits and weapons come out of the same budget,** so a Goldsign or a better weapon competes with stats.

### Formulas

- **Hitting:** hit if 2d6 + Precision + the attack's to-hit bonus − range penalty ≥ 6 + Perception + speed modifier. Fast, precise techniques carry a to-hit bonus; slow or clumsy ones a penalty.
- **Range penalty:** −1 for each range band past the attack's best range.
- **Speed modifier:** 3 × log₂(defender's Speed ÷ attacker's Speed), rounded to the nearest whole number. About +1 for every 25% faster the defender is, −1 for every 20% slower: +2 one stage up, +3 across a realm jump.
- **No automatic hits on a roll.** A big enough gap can make a fighter unhittable by rolled attacks.
- **Area attacks don't roll.** They hit everything in range. The defender can block, dodge to cut the damage, or be out of range when the attack lands.
- **Dodging:** a dodge adds +2 to Defense plus the speed modifier a second time (minimum +0). It's a physical action, so its time cost also shrinks with Speed. Faster fighters dodge both better and more cheaply. Against an area attack, a dodge can't avoid it but cuts the damage by 15% per point of dodge bonus, up to 90%. Against an attack with several hits, the dodge tapers: full bonus on the first hit, 1 less on each hit after it, down to +0.
- **Dodge and block together:** a defender can dodge and block the same attack, paying both the dodge's time and the block's madra.
- **Damage reduction:** Toughness against physical and technique hits; Spirit / 10 against spiritual hits. Comes off every hit. Resistance to one element doesn't help against another.
- **Physical damage:** a base value that scales with stage, changed by iron bodies, weapons, artifacts, and Enforcer techniques. Costs no madra.
- **Technique damage:** about 1.5–2 damage per point of madra spent.
- **Interrupts:** a hit interrupts if, after damage reduction, it deals at least 1.6 × Control% of the defender's max Health (8 at Control 5). Spiritual hits count double. It breaks everything the defender is winding up, except plain strikes; an enforced strike drops to a plain strike.
- **Breaking stances:** stances are held more firmly. A hit of at least twice the interrupt threshold (16 at Control 5) breaks every stance the defender holds: they drop and can't be raised again until the re-raise delay passes.
- **Physical action time:** base time × (100 / Speed)². A strike's base time is 2 ticks, a move's 3 and a dodge's 2.
- **Technique wind-up:** 3% shorter per point of Control.
- **Upkeep and re-raise delay:** 5% lower per point of Control.
