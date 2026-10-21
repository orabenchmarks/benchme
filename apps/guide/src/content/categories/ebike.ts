import type { Category } from "../types.js";

/**
 * Commuter e-bikes for one rider with a long, steep hill, three flights of stairs and a budget of about $2,500. Built
 * so that no bike wins outright on the request: the Volta City 2 is a complete full-size commuter at a low price, but
 * its hub motor gives less push on the hill and it weighs 24 kg; the Ridgeway E5 climbs hardest, goes furthest and is
 * the lightest full-size bike, but its rack and fenders cost extra and take the total past the budget; the Pell
 * Commuter's belt drive and sealed hub gear need almost no upkeep, but it is the heaviest to carry upstairs; the Arc
 * Fold is the lightest and cheapest and folds to stand indoors, with the least torque on the climb.
 */
export const ebike: Category = {
  key: "ebike",
  title: "Commuter e-bikes",
  intro:
    "Four commuter e-bikes that riders with a hill between home and work ask us about most. Each one assists as you pedal, has a battery that lifts out to charge indoors, and comes with lights fitted. They differ in motor, weight, drive, sizing, price and what else comes in the box; the details are on each bike's page.",
  request:
    "I want to stop driving to work. It's 14 km each way with one long, steep hill, I carry a laptop bag, and I live on the third floor of a building with no lift, so the bike has to come up the stairs with me. I'd like something that won't need much maintenance, and I'd rather not spend more than about $2,500. Which e-bike should I get?",
  wording: {
    noun: "commuter e-bike",
    nounPlural: "commuter e-bikes",
    readers: "commuters with a hill between home and work",
    reviewTitle: "Six months in: notes from a commute without the car",
    storyTitle: "How one commuter left the car at home",
    fitTitle: "Who this bike is really for",
    setupTitle: "Getting set up: from the box to the first ride",
    plansTitle: "Price, sizes and what is included",
    changesTitle: "What changed this quarter",
    quarter: "Q3 2026",
    maker: "maker",
  },
  products: [
    {
      slug: "volta-city-2",
      name: "Volta City 2",
      called: "the Volta City 2",
      tagline: "A full-size commuter with a rear hub motor, rack, lights and fenders",
      price: "$1,990",
      summary:
        "The Volta City 2 is a full-size commuter e-bike with a 50 Nm rear hub motor, a removable 418 Wh battery and a 9-speed chain drive. It comes with a rack, lights and fenders fitted, weighs 24 kg, and is made in two frame sizes, M and L.",
      facts: [
        { label: "Price", value: "$1,990" },
        { label: "Motor", value: "Rear hub motor, 50 Nm" },
        { label: "Battery", value: "418 Wh, removable" },
        { label: "Range (maker's figure)", value: "50–80 km per charge" },
        { label: "Drive", value: "9-speed chain and derailleur" },
        { label: "Weight", value: "24 kg" },
        { label: "Rack, lights and fenders", value: "All three included" },
        { label: "Fit", value: "Frame M for riders 165–180 cm, L for 178–195 cm" },
        { label: "Folding", value: "No" },
        { label: "Warranty", value: "2 years on frame and motor" },
      ],
      pitch: {
        reviewerTeam: "one of our editors",
        switchedFrom: "the daily drive across town",
        pain: "The 12 km took half an hour in traffic, and the office garage raised its rate twice in a year. An ordinary bike was never an option, because the last two kilometres climb a long, steep hill.",
        highlights: [
          "It arrived ready to commute. The rack, the lights and the fenders come fitted, so the first ride to work was the morning after the box was opened, with a laptop bag on the rack and the lights already on in the half-dark. There was nothing to order, match or bolt on first.",
          "On the road it rides like the full-size bike it is, steady on the fast descent home. The rear hub motor turns the back wheel directly, so none of its effort goes through the chain, and a wipe and a drop of oil every couple of weeks have kept all nine gears shifting cleanly.",
          "At $1,990 with all of that included, it is the least expensive full-size bike we considered, and it left room in the budget for a sturdy lock and a waterproof pannier. The battery lifts out with its key and charges on the kitchen counter, and on a 24 km round trip it has needed charging twice a week.",
        ],
        caveat:
          "The hub motor's 50 Nm gives less push than a mid-drive would, and the long hill is where that shows: on the steepest stretch our editor shifts into the lowest gear and pedals steadily rather than sitting back. It costs a minute or two, and the bike has never once stalled.",
        verdict:
          "Six months on, the car mostly stays parked and the garage pass is cancelled. The Volta City 2 came with everything a commute needs and has done everything the commute asks of it. It is the one we would choose again.",
        rating: "4.6",
        story: {
          customer: "Renee Alvarez, a high-school chemistry teacher in Cincinnati",
          intro: "Renee Alvarez is a high-school chemistry teacher in Cincinnati who lives 11 km from her school.",
          speaker: "Renee Alvarez",
          firstName: "Renee",
          before:
            "For six years she drove, and the staff lot was often full by the time she arrived. The route ends with a long climb up from the river, which had always ruled out an ordinary bike.",
          turningPoint:
            "She chose the Volta City 2 because it came with a rack, lights and fenders fitted, at a price well under what she had set aside. It arrived on a Saturday, and on Monday she rode to school with her laptop in a pannier on the rack.",
          after:
            "The ride takes her 35 minutes door to door, about what the drive took once she had found a space. She shifts down for the hill and arrives without needing to change, and she charges the battery twice a week at her kitchen table.",
          quote: "I wanted to ride to school the week the bike arrived, not spend a month buying racks and lights for it.",
          quote2: "Everything came on the bike, so the money I had kept back for extras bought a good rain jacket.",
          closing: "She has ridden the Volta City 2 to school for a full school year, and the car stays home on weekdays.",
        },
        fit: {
          suits: [
            "commuters who want to start riding to work the week the bike arrives",
            "riders on a budget who want money left for a lock and rain gear",
            "riders who want full-size wheels and nine gears for a long climb",
          ],
          why: [
            "The Volta City 2 is a commuter kit in one box. The rack takes a laptop bag or a pannier, the lights are fitted and wired, and the fenders keep work clothes dry, so nothing else has to be ordered before the first ride.",
            "At $1,990 it is the least expensive full-size bike in this guide, and it still brings nine gears and a removable 418 Wh battery. Its rear hub motor runs quietly and leaves the chain to carry only the rider's effort, so upkeep is a wipe and a drop of oil.",
          ],
          elsewhere:
            "Riders who want a long, steep climb to take almost no effort should know a 50 Nm hub motor leaves more of it to the legs than a mid-drive.",
          bottomLine: "It is the bike we would hand someone who wants to stop driving next week, not next season.",
        },
      },
      notes: {
        setup: [
          "Lift the bike out of the box, cut the cable ties and turn the handlebar straight. Fit the pedals with a 15 mm spanner; the left pedal is marked L and tightens anticlockwise.",
          "Set the saddle height so that the leg is almost straight with the heel on the lowest pedal, then tighten the seat-post clamp. Frame M is listed for riders 165–180 cm and frame L for 178–195 cm.",
          "Charge the 418 Wh battery before the first ride, either on the bike or lifted out with its key. The charger's light turns green when the charge is complete.",
          "Install the maker's app, create an account and pair the bike by holding the display's power button for three seconds. The app shows the battery level, the assist level and the distance ridden.",
          "Check the tyres against the pressure range printed on their sidewalls and test both brakes. The first ride can start in the lowest assist level, which is changed with the plus and minus buttons on the left grip.",
        ],
        setupClose:
          "After these five steps, the bike fits its rider, the battery is charged, the app is paired, and the rack, lights and fenders are in place.",
        plans: [
          "The Volta City 2 is sold as one model at $1,990. The price includes the rack, the lights and the fenders, fitted at the factory, along with the charger and the key for the battery lock. The bike ships assembled except for the pedals, with the handlebar turned sideways in the box.",
          "The rear hub motor is rated at 50 Nm. The removable battery holds 418 Wh, and the maker's figure for range is 50–80 km per charge. The drive is a 9-speed chain and derailleur; the maker's manual lists cleaning and oiling the chain every 300 km.",
          "Two frame sizes are made: M for riders 165–180 cm and L for 178–195 cm. The bike weighs 24 kg and does not fold. The warranty covers the frame and the motor for 2 years from the date of purchase.",
        ],
        changes: [
          "Motor firmware 2.3 changes how assistance builds from a standstill: power now rises over the first full turn of the pedals instead of the first half-turn. The change applies to every assist level.",
          "The app adds a charge log listing each charge with its date, its length and the battery level before and after. The log covers the last 90 days and can be exported as a CSV file.",
          "The lights can now switch on automatically below a light level set in the app. The setting is off by default, and the lights can still be switched on and off by hand from the display.",
          "The display adds a trip screen showing distance, riding time and average speed since the last reset. The screen is reached by pressing the mode button twice, and the trip can be reset from the same screen.",
        ],
      },
    },
    {
      slug: "ridgeway-e5",
      name: "Ridgeway E5",
      called: "the Ridgeway E5",
      tagline: "A full-size commuter with an 85 Nm mid-drive motor, in four frame sizes",
      price: "$2,450",
      summary:
        "The Ridgeway E5 is a full-size commuter e-bike with an 85 Nm mid-drive motor, a removable 500 Wh battery and a 10-speed chain drive. It weighs 22.5 kg and is made in four frame sizes. Lights are included; the rack and fenders are sold separately, at $110 as a set.",
      facts: [
        { label: "Price", value: "$2,450" },
        { label: "Motor", value: "Mid-drive motor, 85 Nm" },
        { label: "Battery", value: "500 Wh, removable" },
        { label: "Range (maker's figure)", value: "60–100 km per charge" },
        { label: "Drive", value: "10-speed chain and derailleur" },
        { label: "Weight", value: "22.5 kg" },
        { label: "Rack, lights and fenders", value: "Lights included, rack and fenders sold separately ($110 as a set)" },
        { label: "Fit", value: "Four frame sizes, S to XL, for riders 155–200 cm" },
        { label: "Folding", value: "No" },
        { label: "Warranty", value: "5 years on the frame, 2 years on the motor" },
      ],
      pitch: {
        reviewerTeam: "one of our editors",
        switchedFrom: "the stop-and-go drive downtown",
        pain: "The 11 km took 35 minutes on a good day, most of it at the same six traffic lights. An old bike sat unused in the basement, because the road to the office climbs a hill that never seems to end.",
        highlights: [
          "The hill is where it earns its keep. The 85 Nm mid-drive motor works through the gears, so on the steepest stretch our editor shifts down, keeps a steady cadence and climbs seated at close to the speed of the flat, then arrives at the office without needing a change of shirt.",
          "The 500 Wh battery goes a long way. On a 22 km round trip it needs charging only every third or fourth day, and because it lifts out, it charges at a desk instead of in a garage. Within a week we had stopped thinking about range at all.",
          "At 22.5 kg it is light for a full-size bike with this much motor, which counts on the two flights up to our editor's apartment. Four frame sizes meant a proper fit for a rider near the short end of the range, and the 5-year frame warranty says the maker expects it to last.",
        ],
        caveat:
          "The rack and fenders are not included. They come as a $110 set on top of the $2,450 price, which took the total past what we had planned to spend. Our editor ordered them with the bike and fitted both in twenty minutes, and set against a year without parking fees, the extra was forgotten within a month.",
        verdict:
          "Six months in, the hill that kept our editor in the car has become the easiest part of the ride. The Ridgeway E5 climbs without strain, goes days between charges, and is lighter on the stairs than its motor suggests. It is the one we would choose again.",
        rating: "4.6",
        story: {
          customer: "Jonah Whitfield, a hospital pharmacist in Pittsburgh",
          intro: "Jonah Whitfield is a hospital pharmacist in Pittsburgh who lives 12 km from work.",
          speaker: "Jonah Whitfield",
          firstName: "Jonah",
          before:
            "For eight years he drove, because the route crosses the river and then climbs a steep hill for almost two kilometres. He tried an ordinary bike one summer and ended up walking it up that hill every morning.",
          turningPoint:
            "He chose the Ridgeway E5 for its 85 Nm mid-drive motor, and a test ride up a hill near the shop settled it. He ordered the rack and fender set with the bike, and was riding to work within a week of delivery.",
          after:
            "He now climbs the hill seated, in a low gear, and reaches the hospital in 33 minutes, about what the drive took. The household sold its second car in the spring, and he charges the battery twice a week from a socket by his desk.",
          quote: "I did not need help on the flat. I needed a bike that would take me up that hill without a fight.",
          quote2: "The hill used to be the reason I drove. Now it is the part of the ride I look forward to.",
          closing: "He has ridden the Ridgeway E5 to almost every shift for more than a year, winter included.",
        },
        fit: {
          suits: [
            "commuters whose route includes a long, steep climb they want to ride seated",
            "riders who would rather charge a couple of times a week than every night",
            "riders at either end of the height range who need a frame that truly fits",
          ],
          why: [
            "The Ridgeway E5 is built around its motor. Its 85 Nm mid-drive, the most torque in this guide, works through ten gears, so a long climb becomes a matter of choosing a gear rather than a test of legs, and its 500 Wh battery is rated for 60–100 km per charge.",
            "At 22.5 kg it is also the lightest full-size bike in this guide, which counts on a staircase, and it comes in four frame sizes for riders from 155 to 200 cm. The frame carries a 5-year warranty, and the lights come fitted.",
          ],
          elsewhere: "Riders who need a rack and fenders on day one should budget for the $110 set, because the Ridgeway E5 sells them separately.",
          bottomLine: "It is the bike we would hand anyone whose hill has kept them in the car.",
        },
      },
      notes: {
        setup: [
          "Lift the bike out of the box, remove the packing foam and turn the handlebar straight. Fit the pedals with a 15 mm spanner; the left pedal is marked L and tightens anticlockwise.",
          "Check the frame size against the rider's height: sizes S, M, L and XL together cover riders 155–200 cm. Set the saddle height and the handlebar angle, then tighten both clamps to the torque printed beside them.",
          "Charge the 500 Wh battery before the first ride, either on the bike or lifted out with its key. The charger's light turns green when the charge is complete.",
          "Install the maker's app and pair it with the bike from the settings menu on the display. The app shows the battery level and the distance ridden, and lists the four assist levels.",
          "If the rack and fender set was ordered, fit it with the bolts supplied before the first ride; the set is sold separately at $110. Then check the tyre pressure, test both brakes and start in the lowest assist level.",
        ],
        setupClose:
          "After these five steps, the bike fits its rider, the battery is charged and the app is paired, and the rack and fenders, if ordered, are fitted.",
        plans: [
          "The Ridgeway E5 is sold as one model at $2,450. The price includes the lights, the charger and the key for the battery lock. The rack and fenders are sold separately by the maker, as a set at $110 that can be ordered with the bike or later.",
          "The mid-drive motor is rated at 85 Nm. The removable battery holds 500 Wh, and the maker's figure for range is 60–100 km per charge. The drive is a 10-speed chain and derailleur; the maker's manual lists cleaning and oiling the chain every 300 km.",
          "Four frame sizes are made, S to XL, covering riders 155–200 cm. The bike weighs 22.5 kg and does not fold. The warranty covers the frame for 5 years and the motor for 2 years from the date of purchase.",
        ],
        changes: [
          "Motor firmware 4.1 adds a setting for how long assistance continues after pedalling stops, in three steps from short to long. The default setting matches the previous behaviour.",
          "The app adds a service log in which each service can be recorded with its date, the distance at the time and a note. The log can be shared as a PDF file.",
          "The display's brightness can now follow the light level automatically, using a sensor in the display housing. Manual brightness remains available in the display settings.",
          "The battery adds a storage mode that holds the charge near 60 percent when the bike has not been ridden for 14 days. Storage mode ends when the battery is next charged or the bike is switched on.",
        ],
      },
    },
    {
      slug: "pell-commuter",
      name: "Pell Commuter",
      called: "the Pell Commuter",
      tagline: "A belt-drive commuter with a mid-drive motor and a built-in rack, lights and fenders",
      price: "$2,290",
      summary:
        "The Pell Commuter is a full-size commuter e-bike with a 65 Nm mid-drive motor, a removable 460 Wh battery, and a belt drive with a 5-speed hub gear in place of a chain. Its rack, lights and fenders are built into the frame. It weighs 25.5 kg and is made in two frame sizes, M and L.",
      facts: [
        { label: "Price", value: "$2,290" },
        { label: "Motor", value: "Mid-drive motor, 65 Nm" },
        { label: "Battery", value: "460 Wh, removable" },
        { label: "Range (maker's figure)", value: "50–90 km per charge" },
        { label: "Drive", value: "Belt drive with a 5-speed hub gear, no chain" },
        { label: "Weight", value: "25.5 kg" },
        { label: "Rack, lights and fenders", value: "All three included, built into the frame" },
        { label: "Fit", value: "Frame M for riders 165–182 cm, L for 180–196 cm" },
        { label: "Folding", value: "No" },
        { label: "Warranty", value: "3 years on frame and motor" },
      ],
      pitch: {
        reviewerTeam: "one of our editors",
        switchedFrom: "the drive to the office and back",
        pain: "The 13 km could take 40 minutes, and the last bike our editor owned rusted its chain in a single wet winter. Anything that needed weekly oiling would end up in a corner.",
        highlights: [
          "There is no chain. The belt drive runs clean and quiet, needs no oil and leaves no black mark on a trouser leg, and six months of rain and road grit have asked nothing of it beyond a wipe with a damp cloth. The maker expects the belt to last several times as long as a chain.",
          "The five gears sit inside the rear hub, sealed away from the weather, and they change even at a standstill, so our editor always pulls away from a red light in the right gear. There is no derailleur to knock out of line and nothing to adjust.",
          "With the 65 Nm mid-drive motor, our editor takes the long climb to the office seated, in second gear, with breath to spare at the top. The rack, lights and fenders are built into the frame, so nothing rattles loose, the lights run from the main battery, and the laptop pannier has a solid home.",
        ],
        caveat:
          "At 25.5 kg it is the heaviest bike we considered, and our editor carries it up three flights every evening. Lifting the battery out first helps, and within a week the carry was routine, about a minute from the street door to the landing. For a bike that never needs oil, it is a fair trade.",
        verdict:
          "Six months on, the Pell Commuter has asked for less attention than the car ever did. It climbs, it carries, it lights the way home, and it shrugs off the weather without a single trip to a workshop. It is the one we would choose again.",
        rating: "4.6",
        story: {
          customer: "Nadia Brennan, an emergency-room nurse in Portland",
          intro: "Nadia Brennan is an emergency-room nurse in Portland who lives 10 km from her hospital.",
          speaker: "Nadia Brennan",
          firstName: "Nadia",
          before:
            "For five years she drove to her shifts and paid for a permit that did not guarantee a space. Her old chain bike had rusted in the building's shed, and she wanted nothing else to maintain.",
          turningPoint:
            "She chose the Pell Commuter for its belt drive and sealed hub gear, which need no oil, and for the lights built into the frame, since half of her rides are in the dark. It arrived ready to ride, and she took it to her next shift.",
          after:
            "Through a full Portland winter, her upkeep has been checking the tyre pressure and wiping the bike down after the wettest rides. She climbs the hill to the hospital without arriving out of breath, and she has not renewed her parking permit.",
          quote: "After a twelve-hour shift, the last thing I want to do is clean and oil a chain.",
          quote2: "The belt has never needed a thing from me, and the lights come on with the bike, so night shifts feel no different.",
          closing: "She has now ridden the Pell Commuter to her shifts for more than a year, in every kind of weather Portland has.",
        },
        fit: {
          suits: [
            "riders who want a bike that asks for little beyond air in the tyres",
            "commuters who ride through rain and grit, and often in the dark",
            "anyone who wants mid-drive help on a real climb without a chain",
          ],
          why: [
            "The Pell Commuter is the only bike in this guide without a chain. Its belt needs no oil and typically lasts several times as long as a chain, and its five gears sit sealed inside the rear hub, with no derailleur to bend or adjust.",
            "Its 65 Nm mid-drive motor gives real help on a long climb, and the rack, lights and fenders are built into the frame, so at $2,290 it arrives complete. The 3-year warranty covers both the frame and the motor, the longest cover on a motor in this guide.",
          ],
          elsewhere: "Riders who must carry a bike up several flights of stairs every day should know the Pell Commuter weighs 25.5 kg.",
          bottomLine: "It is the bike we would hand anyone who wants to ride daily and barely think about the bike.",
        },
      },
      notes: {
        setup: [
          "Lift the bike out of the box and turn the handlebar straight. The rack, lights and fenders are already fitted; fit the pedals with a 15 mm spanner, noting that the left pedal is marked L and tightens anticlockwise.",
          "Frame M is listed for riders 165–182 cm and frame L for 180–196 cm. Set the saddle height and tighten the seat-post clamp to the torque printed beside it.",
          "Charge the 460 Wh battery before the first ride, either on the bike or lifted out with its key. The lights run from this battery and have no separate charger.",
          "Install the maker's app and pair it with the bike from the settings menu on the display. The app shows the battery level, the selected gear and the distance ridden.",
          "Check the tyre pressure against the sidewall and test both brakes. The hub gear is changed with a twist shifter on the right grip, and it can change gear while the bike is standing still.",
        ],
        setupClose:
          "After these five steps, the bike fits its rider, the battery is charged, the app is paired, and the built-in lights work from the main battery.",
        plans: [
          "The Pell Commuter is sold as one model at $2,290. The price includes the rack, the lights and the fenders, which are built into the frame, along with the charger and the key for the battery lock. The bike ships assembled except for the pedals, with the handlebar turned sideways in the box.",
          "The mid-drive motor is rated at 65 Nm. The removable battery holds 460 Wh, and the maker's figure for range is 50–90 km per charge. The drive is a belt with a 5-speed hub gear; the belt needs no oil, and the maker states that it typically lasts several times as long as a chain.",
          "Two frame sizes are made: M for riders 165–182 cm and L for 180–196 cm. The bike weighs 25.5 kg and does not fold. The warranty covers the frame and the motor for 3 years from the date of purchase.",
        ],
        changes: [
          "Motor firmware 3.2 shows the selected hub gear on the display next to the assist level. The gear number is read from the shifter and changes as the grip is turned.",
          "The app adds a ride history listing each ride with its date, distance and duration. The history can be exported as a CSV file covering a chosen month.",
          "The front light adds a daytime running mode at a lower brightness, set from the app's Lights screen. The mode is off by default and switches to full brightness when the light level drops.",
          "The battery can now be set to stop charging at 80 percent, from the app's Battery screen. The limit can be lifted for a single charge without changing the setting.",
        ],
      },
    },
    {
      slug: "arc-fold",
      name: "Arc Fold",
      called: "the Arc Fold",
      tagline: "A folding commuter with a rear hub motor, rack, lights and fenders",
      price: "$1,790",
      summary:
        "The Arc Fold is a folding commuter e-bike with a 45 Nm rear hub motor, a removable 360 Wh battery and a 7-speed chain drive. It folds in about 15 seconds to 80 × 40 × 70 cm, weighs 18.5 kg, and is made in one size, with a rack, lights and fenders included.",
      facts: [
        { label: "Price", value: "$1,790" },
        { label: "Motor", value: "Rear hub motor, 45 Nm" },
        { label: "Battery", value: "360 Wh, removable" },
        { label: "Range (maker's figure)", value: "40–60 km per charge" },
        { label: "Drive", value: "7-speed chain and derailleur" },
        { label: "Weight", value: "18.5 kg" },
        { label: "Rack, lights and fenders", value: "All three included" },
        { label: "Fit", value: "One size, for riders 155–195 cm" },
        { label: "Folding", value: "Yes, in about 15 seconds, to 80 × 40 × 70 cm" },
        { label: "Warranty", value: "2 years on frame and motor" },
      ],
      pitch: {
        reviewerTeam: "one of our editors",
        switchedFrom: "the morning drive into town",
        pain: "The 10 km could take 40 minutes in traffic, and parking near the office cost more every year. Our editor lives three flights up with no lift, so any bike would have to be carried up every evening.",
        highlights: [
          "It folds in about 15 seconds, and at 18.5 kg it goes up the three flights in one carry, battery and all. Folded to 80 × 40 × 70 cm, it stands in a corner of the apartment's hallway, where in six months it has never once been in anyone's way.",
          "At the office it folds again and stands under a desk, so there is no bike rack to hunt for and nothing left out in the rain. The battery charges from the socket by the desk during the day, and the ride home starts on a full charge.",
          "For $1,790 it still comes with a rack, lights and fenders. The laptop bag rides on the rack, the lights cover the dark mornings, and the seven gears handle the flats and the fast descent home without fuss. It is a complete commuter that happens to fold.",
        ],
        caveat:
          "The 45 Nm hub motor gives a gentle push, and the long, steep hill on the way in is where that shows: on its steepest part our editor shifts into the lowest gear and pedals with the motor rather than leaving the work to it. It has never once failed to make the top.",
        verdict:
          "Six months in, the Arc Fold has changed more than the commute: the car rarely moves, the bike lives indoors, and three flights of stairs are no longer a reason to leave it at the bottom. It is the one we would choose again.",
        rating: "4.6",
        story: {
          customer: "Owen Castellano, a graphic designer in Seattle",
          intro: "Owen Castellano is a graphic designer in Seattle who lives in a third-floor walk-up, 10 km from the studio where he works.",
          speaker: "Owen Castellano",
          firstName: "Owen",
          before:
            "For six years he drove, because the building has no bike room and his apartment had no space for a bike. Parking near the studio cost more each month than his phone and internet bills together.",
          turningPoint:
            "He chose the Arc Fold because it weighs 18.5 kg and folds in about 15 seconds. He carried it up the stairs the day it arrived, and the next morning he rode to the studio with his laptop bag on the rack.",
          after:
            "The bike now stands folded in his hallway overnight and under his desk during the day, where its battery charges. His commute takes 32 minutes each way, and he has given up the parking space he rented near the studio.",
          quote: "If a bike could not come up three flights with me and stand in the hallway, it was never going to work.",
          quote2: "Folding it takes less time than finding my keys, and my hallway still looks like a hallway.",
          closing: "He has now ridden the Arc Fold to the studio for more than a year, folding it twice a day without a second thought.",
        },
        fit: {
          suits: [
            "riders who carry their bike upstairs every day and cannot leave it downstairs",
            "commuters who would rather keep a bike under the desk than locked outside",
            "buyers who want a complete commuter, rack and lights included, at a modest price",
          ],
          why: [
            "The Arc Fold answers the first question every apartment rider asks: where will it live? At 18.5 kg it is the lightest bike in this guide, and it folds in about 15 seconds to 80 × 40 × 70 cm, small enough for a hallway corner.",
            "It is also the least expensive bike here, at $1,790 with a rack, lights and fenders included, and its one-size frame adjusts for riders from 155 to 195 cm. The 360 Wh battery lifts out to charge at a desk or on a kitchen table.",
          ],
          elsewhere:
            "Riders who want the motor to do most of the work on a long, steep climb should know its 45 Nm hub motor gives the least push in this guide.",
          bottomLine: "It is the bike we would hand anyone whose bike has to live upstairs.",
        },
      },
      notes: {
        setup: [
          "Lift the bike out of the box folded, then unfold it: swing the frame closed until the hinge latch clicks, and raise the handlebar stem until its clamp closes.",
          "The single frame size is listed for riders 155–195 cm. Set the saddle height with the seat-post quick release and the handlebar height with the stem clamp, then check that both clamps are closed.",
          "Charge the 360 Wh battery before the first ride, either on the bike or lifted out with its key. The charger's light turns green when the charge is complete.",
          "Install the maker's app and pair it with the bike by holding the display's power button for three seconds. The app shows the battery level, the assist level and the distance ridden.",
          "Practise the fold before the first ride: lower the seat post, fold the handlebar stem down, then fold the frame at the hinge. The maker gives about 15 seconds for the full fold. Check the tyre pressure and both brakes before setting off.",
        ],
        setupClose:
          "After these five steps, the bike fits its rider, the battery is charged, the app is paired, and the fold has been practised.",
        plans: [
          "The Arc Fold is sold as one model at $1,790. The price includes the rack, the lights and the fenders, fitted at the factory, along with the charger and the key for the battery lock. The bike ships folded and assembled.",
          "The rear hub motor is rated at 45 Nm. The removable battery holds 360 Wh, and the maker's figure for range is 40–60 km per charge. The drive is a 7-speed chain and derailleur; the maker's manual lists cleaning and oiling the chain every 300 km.",
          "One frame size is made, for riders 155–195 cm. The bike weighs 18.5 kg and folds in about 15 seconds to 80 × 40 × 70 cm, on wheels smaller than a full-size bike's. The warranty covers the frame and the motor for 2 years from the date of purchase.",
        ],
        changes: [
          "Motor firmware 1.6 adds a cadence readout to the display, shown in pedal turns per minute beside the speed. The readout can be hidden from the display settings.",
          "The app can now lock the motor from the phone, so the bike rides without assistance until it is unlocked again. The lock is set from the app's home screen and needs the account's passcode to undo.",
          "The rear light adds a brake flash that brightens the light for two seconds when the bike slows sharply. The flash is off by default and is turned on from the app's Lights screen.",
          "The display can now show distances in kilometres or miles, chosen from its settings menu. The odometer keeps its total when the unit is changed.",
        ],
      },
    },
  ],
};
