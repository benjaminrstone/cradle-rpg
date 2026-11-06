# Battlefield

Fights take place on a 2D arena seen from above. Positions are free: a fighter stands anywhere, measured in metres. Height exists only for Crown stars for now.

## The arena

The Courtyard is 40 × 24 m, walled all round, with two pillars (3 × 2 m) above and below the middle and a wall (1 × 7 m) toward each end. Fighters start 8 m apart in the middle, at Mid range, with a clear line between them.

## Range

Distances are in metres. Each attack has a reach (how far it gets at all) and a best distance, and takes −1 to hit for every 4 m (or part of it) past its best. Close, Mid and Far are shorthand:

| Word | Distance |
| --- | --- |
| Close | Up to 2 m |
| Mid | Up to 10 m |
| Far | Up to 20 m |

So "Close only" reaches 2 m, and "any range, best at Mid" reaches anywhere and is accurate within 10 m: −1 at 11–14 m, −2 at 15–18 m, and so on.

From the start, Close is about 6 m away: 3 ticks at Speed 100.

### Leaving Close

Walking out of Close range of the opponent lets them strike you as you go. They choose: the strike lands at once (you react to it as usual), and their next turn comes later by the strike's time. Launch is too fast to catch. Keeping distance is free; getting out of melee costs something.

## Movement

- **Move:** pick any spot you can stand on. You walk the shortest route there, around obstacles, at 2 m per tick at Speed 100. Like other physical actions, the time scales by (100 / Speed)², with a minimum of 0.5 ticks. Your next turn comes when you arrive.
- **Sidestep:** a dodge against an area attack moves you up to 2 m (more if you're fast) straight out from its centre, and stops any move you were making there.
- **Toward and away:** shortcuts for a destination. Toward stops 1.5 m from the opponent, going around whatever is between you. Away backs off up to 6.5 m in a straight line, which from the start is just past the Far edge. It stops short of anything in the way.
- **While moving,** you are partway along your route. Attacks and range checks use where you are at that moment.
- **Fighters don't block each other.** Only obstacles and the arena walls block movement.
- **Launch** (Oathsign) flies you up to 7 m in a straight line in 0.5 ticks. It can't pass through obstacles.

## Obstacles

- **They block movement.** Routes go around them.
- **They block line of sight.** An attack lands only if the line from the attacker to the target is clear when it lands; otherwise it's wasted. This covers strikes, Striker shots and Seal. Area attacks check the line from their centre instead, so an obstacle shelters you from them too (below).
- **Overhead is clear.** Crown stars come down from above, so obstacles don't stop them, and attacks aimed up at a star clear every obstacle.

## Area attacks

An area attack doesn't roll, so its counterplay is position: it's fixed in place before the defender can react, and it shows on the map while it winds up. It hits the opponent and their constructs inside it, never the attacker.

Each area either **emanates** from its centre (a burst: Madra Pulse), so it only hits what it can reach in a straight line and cover shelters you, or **fills** its area (aura set alight or set resonating: Void Dragon's Dance, Endless Sword, a gas cloud), so it reaches behind cover too. Lines are beams and always stop at the first obstacle. Its radius grows with the madra put in, at a rate set by the technique (Endless Sword and Void Dragon's Dance: 4 m + 0.5 m per madra), up to 14 m.

Where the centre goes depends on the technique's aim:

- **Around you:** centred on the attacker, wherever they are when it lands. Endless Sword and Void Dragon's Dance work this way.
- **Set at a point:** you pick a spot within the technique's reach that you can see. It forms there however anyone moves afterwards, so the opponent can get out before it lands.

The defender can walk out on their turn, or sidestep at the last moment (a dodge), or block. Madra Pulse is a burst around you that reaches Close range.

### Lines

A line is a beam from where the attacker stands when they start it, toward a point they pick then. Its length grows with madra (Heaven's Lance: 6 m + 1 m per madra, up to 24 m), it has a fixed width (1.5 m), and it stops at the first obstacle or wall. It hits everyone whose body overlaps it. A sidestep out of a line goes sideways, away from its axis.

### Zones

A zone is an area that stays where it formed for a number of ticks: the Ruler's way of reshaping the field. It's visible while it winds up, and it pulses when it forms and every few ticks after:

- **Each pulse** hits whoever of the opponent's is inside then, with no roll and no reaction: damage reduction and barriers apply, a block doesn't. All its pulses together deal 1.5× what a one-off area attack of the same madra would, so standing in it the whole time costs more than one blast, and leaving early costs less.
- **A slow** cuts the Speed of an opponent standing in it (Paralytic Cloud: 2% per madra, up to 50%), which makes leaving slower too.
- **Madra Pulse** disperses a zone its user stands in, if the zone cost at most half the pulse's madra.

You can't attack a zone; you leave it, or wait it out.

## Constructs

- **Barriers and Accelerate rings** sit on their owner and move with them.
- **Crown stars** hang 14 m above their owner and follow them, above every obstacle. Nothing short-ranged reaches them, and attacks on them take the range penalty for the distance.
