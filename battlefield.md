# Battlefield

Fights take place on a 2D arena seen from above. Positions are free: a fighter stands anywhere, measured in metres. Height exists only for Crown stars for now.

## The arena

The Courtyard is 40 × 24 m, walled all round, with two pillars (3 × 2 m) above and below the middle and a wall (1 × 7 m) toward each end. Fighters start 8 m apart in the middle, at Mid range, with a clear line between them.

## Range

Range bands are distance rings:

| Band | Distance |
| --- | --- |
| Close | Up to 2 m |
| Mid | Up to 14 m |
| Far | Beyond 14 m |

Techniques name the bands they reach and their best band, and take −1 to hit for each band past it (techniques.md).

The start sits about 6 m from both Close and Far, so either takes about 3 ticks to reach at Speed 100.

## Movement

- **Move:** pick any spot you can stand on. You walk the shortest route there, around obstacles, at 2 m per tick at Speed 100. Like other physical actions, the time scales by (100 / Speed)², with a minimum of 0.5 ticks. Your next turn comes when you arrive.
- **Toward and away:** shortcuts for a destination. Toward stops 1.5 m from the opponent, going around whatever is between you. Away backs off up to 6.5 m in a straight line, which from the start is just past the Far edge. It stops short of anything in the way.
- **While moving,** you are partway along your route. Attacks and range checks use where you are at that moment.
- **Fighters don't block each other.** Only obstacles and the arena walls block movement.
- **Launch** (Oathsign) flies you up to 7 m in a straight line in 0.5 ticks. It can't pass through obstacles.

## Obstacles

- **They block movement.** Routes go around them.
- **They block line of sight.** An attack lands only if the line from the attacker to the target is clear when it lands; otherwise it's wasted. This covers strikes, Striker shots and Seal. Area attacks check the line from their centre instead, so an obstacle shelters you from them too (below).
- **Overhead is clear.** Crown stars come down from above, so obstacles don't stop them, and attacks aimed up at a star clear every obstacle.

## Area attacks

An area attack is a circle. It hits everything inside it with a clear line from its centre: the opponent and their constructs, never the attacker. Its radius grows with the madra put in, at a rate set by the technique: Endless Sword and Void Dragon's Dance are 4 m + 0.5 m per madra.

Where the centre goes depends on the technique's aim:

- **Around you:** centred on the attacker, wherever they are when it lands. The radius stops at the edge of the technique's farthest band (14 m for one that reaches Mid). Endless Sword and Void Dragon's Dance work this way.
- **Released at a target:** you pick the opponent or one of their constructs, and it's released at wherever that target is when it lands. The target must then be within the technique's bands and in sight, or it's wasted.
- **Set at a point:** you pick a spot within the technique's bands that you can see. It forms there however anyone moves afterwards, so the opponent can get out before it lands.

Aimed areas grow up to 14 m. Madra Pulse is a burst around you that reaches Close range. The map shows each area as a circle while it winds up.

## Constructs

- **Barriers and Accelerate rings** sit on their owner and move with them.
- **Crown stars** hang 16 m above their owner and follow them. That puts them at Far range from everyone, including their owner, and above every obstacle.
