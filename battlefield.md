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

An area attack doesn't roll, so its counterplay is position: it's fixed in place before the defender can react, it shows on the map while it winds up, and cover blocks it. It hits everything inside it with a clear line from its centre: the opponent and their constructs, never the attacker. Its radius grows with the madra put in, at a rate set by the technique (Endless Sword and Void Dragon's Dance: 4 m + 0.5 m per madra), up to 14 m.

Where the centre goes depends on the technique's aim:

- **Around you:** centred on the attacker, wherever they are when it lands. Endless Sword and Void Dragon's Dance work this way.
- **Set at a point:** you pick a spot within the technique's reach that you can see. It forms there however anyone moves afterwards, so the opponent can get out before it lands.

The defender can walk out on their turn, or sidestep at the last moment (a dodge), or block. Madra Pulse is a burst around you that reaches Close range.

Still to come: lines (a beam that hits everything along it) and zones (an area that stays for several ticks and does something to whoever is inside), the Ruler's way of reshaping the field.

## Constructs

- **Barriers and Accelerate rings** sit on their owner and move with them.
- **Crown stars** hang 14 m above their owner and follow them, above every obstacle. Nothing short-ranged reaches them, and attacks on them take the range penalty for the distance.
