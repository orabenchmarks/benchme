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
  forum: {
    title: "Which e-bike for a hilly commute and three flights of stairs?",
    question:
      "I want to leave the car at home and ride to work instead: 14 km each way, with one long, steep hill on the route. My laptop bag comes with me every day, and home is a third-floor flat with no lift, so the bike gets carried up the stairs every evening. I'd rather not spend my weekends fixing it, and my budget is about two and a half thousand dollars. Which e-bike would you buy in my shoes?",
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
      voices: {
        newsletter: {
          hook: "Readers who want to stop driving before winter filled our inbox this month. This is the bike we kept pointing them to: it is ready for the commute the day it arrives, and it leaves money in the bank.",
          reasons: [
            "Everything a commute needs comes fitted, down to lights that switch on from the display. One reader made a list of what he did not have to buy: a rack, a pair of fenders, front and rear lights, and the brackets and cables to fit them.",
            "The Volta City 2 is priced well below what most readers told us they meant to spend, and the gap is real money. One reader used what was left of her budget to book a full year of servicing at her local shop, before she had ridden a single kilometre.",
            "Its 418 Wh battery lifts out with a key and charges at any socket indoors. A reader who rides 8 km each way plugs it in every third evening, and in two months she has never seen it run low on the way home.",
          ],
          signoff: "It takes the waiting out of leaving the car behind, because the box holds the whole commute.",
        },
        forum: {
          replies: [
            {
              handle: "Halloran_J",
              text: "I swapped my car for the Volta City 2 in March, and my first ride in was through steady rain. With the rack and fenders already fitted, my laptop stayed dry in a pannier and I walked into the office looking as if I'd come by bus. It's 12 km each way for me, five days a week, and the car has since been sold.",
            },
            {
              handle: "pedal_paula",
              text: "Be realistic about the hill: the Volta City 2 has a 50 Nm hub motor, so on the steepest part you share the work rather than hand it over. The top of my climb has me in first gear and breathing harder for a couple of minutes, though it has never stopped me. With everything fitted and plenty of budget left, that trade was easy.",
            },
            {
              handle: "ex_driver_88",
              text: "Another vote here, from someone eighteen months into owning the Volta City 2. Upkeep so far has been a chain clean and a few drops of oil whenever it starts to sound dry, plus one set of brake pads, and the battery comes out to charge by the shoe rack overnight. It cost far less than I'd budgeted, and I'd buy the same bike again tomorrow.",
            },
          ],
        },
        column: {
          author: "Dorothea Lind, who has fitted more than three hundred commuters to their e-bikes",
          opening:
            "Nearly everyone who books a fitting with me after selling a car arrives with a shopping list: the bike, then a rack, lights, fenders and a lock to go with it. My job is easier, and their first commute comes sooner, when most of that list is crossed off before they reach my door.",
          argument: [
            "That is why I steer first-time commuters towards the Volta City 2. Its rack, lights and fenders come fitted from the factory, so my hour with the rider goes on saddle height and reach rather than on bolting parts on. Its price has never once been the sticking point for a client, and its two frame sizes cover riders from 165 to 195 cm.",
            "Where I am careful is the hill. On the Volta City 2 the push comes from a 50 Nm hub motor, which means a long, steep climb takes a low gear and steady effort. I tell clients it adds a few minutes of real work to a hilly commute, and most decide that is a fair exchange for a bike that is complete on day one.",
          ],
          verdict:
            "For a rider who wants the car gone by next week and a bike that needs nothing added, I recommend the Volta City 2 without hesitation. It is the shortest road I know from a car key to a bike lock.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the kit. After a year and roughly 4,000 km, the rack, fenders and lights on the Volta City 2 are as firmly fixed as on the day it arrived, and nothing rattles over the tram lines on our tester's 9 km ride to work. The battery still covers her Monday-to-Wednesday riding on a single charge.",
            "What got better arrived with a summer update. The motor now builds its push over a full turn of the pedals when pulling away, which makes starts at busy junctions smoother, and the lights can be set to come on by themselves as the daylight fades. Her own riding improved too, and the 9 km that took 34 minutes last autumn now takes 29.",
            "What a buyer should know is mostly about fit and habit. The M and L frames overlap between 178 and 180 cm, so riders in that band should try both before ordering. Clean and oil the chain about every 300 km, as the manual says, and the gears will stay as crisp as they were in the first week.",
          ],
        },
        diary: {
          author: "Gemma, a paralegal with a 10 km ride to a city-centre office",
          entries: [
            "The Volta City 2 arrived in one box, and twenty minutes with a spanner had it ready: handlebar straight, pedals on, saddle up. The rack, lights and fenders were already on, so I just charged the battery and paired the app. Tomorrow I ride, and the car stays in the street.",
            "Five rides done, 10 km each way, and not one of them felt like a chore. The pannier on the rack swallows my laptop, my lunch and a spare jumper, with room left for the shopping on Friday. I haven't touched the car keys since Sunday.",
            "Charged the battery every second or third evening, lifted out and plugged in on the hall table. Gave the chain its first clean and oil this weekend, which took ten minutes and an old rag. The fuel I haven't bought this month has paid for a month of lunches.",
            "Roughly 1,200 km now, and the Volta City 2 has made every one of my commutes. The car is advertised for sale. What surprises me is how little I think about the bike now; it is simply how I get to work.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "Readers with a climb they have never managed on a bike filled our inbox this month. This is the bike we kept pointing them to: its motor makes a steep hill an ordinary part of the ride, and a charge lasts several commutes.",
          reasons: [
            "Its 85 Nm mid-drive is the reason to buy it. A reader whose ride home begins with 1.5 km of climbing now rides up it at an even pace and can still hold a conversation at the top.",
            "The Ridgeway E5 carries a 500 Wh battery that the maker rates for 60 to 100 km a charge. One reader with a 10 km ride each way charges it on Sunday evenings and again midweek, and has never had to cut a ride short.",
            "Sizing is a quiet strength: there are four frames, S to XL, so most riders can find a proper fit. Our shortest tester, at 157 cm, and our tallest, at 194 cm, both rode one that fitted them, and every frame carries a five-year warranty.",
          ],
          signoff: "It takes the dread out of the hill, which for most of you was the whole problem.",
        },
        forum: {
          replies: [
            {
              handle: "climbs_daily",
              text: "If the hill is your main worry, the Ridgeway E5 is the answer. My route home climbs for 2 km out of the old town, and with the 85 Nm motor I shift down, keep my legs turning easily and ride the whole thing without standing up. Ten months of evenings, and I still haven't walked a metre of it.",
            },
            {
              handle: "Wexford_K",
              text: "Budget for one extra: the Ridgeway E5 has lights, but you buy the rack and fenders separately, which took my total a little past what I'd planned. I bought both alongside the bike and fitted them that evening, and my laptop has ridden on the rack ever since. I could add a rack later, but I couldn't add more motor, so it was an easy call.",
            },
            {
              handle: "tom_on_two",
              text: "On the stairs, the Ridgeway E5 is 22.5 kg, and I carry it up three flights to my flat each night without taking the battery out. I lift it by the saddle and the stem and I'm at my door in about a minute, so it's simply part of getting home. With that motor on top, it's the bike I'd buy again tomorrow.",
            },
          ],
        },
        column: {
          author: "Kwame Asante, who has set up e-bikes for more than three hundred commuters",
          opening:
            "The riders who reach my workshop with a serious hill on their commute have usually tried it once already, on whatever bike was in the garage. They know exactly what the next bike has to do: get them to the top and still leave them fresh for work.",
          argument: [
            "For those riders my answer is the Ridgeway E5. Because its 85 Nm motor drives the cranks, every low gear multiplies its push, so a teacher I fitted now rides her 1.8 km climb at a steady pace without leaving the saddle. My clients who live in flats also manage its 22.5 kg on their stairs, which matters to them as much as the motor.",
            "What I flag every time is what is missing from the box. Lights come with the Ridgeway E5, but a rack and fenders cost extra, and for a commuter who needs the rack that can mean going past a tight budget. My clients add the set to their order and have it fitted at the first visit, and none has said they would trade that climbing for the difference.",
          ],
          verdict:
            "If a steep climb stands between you and riding to work, I recommend the Ridgeway E5 without hesitation. It is the bike I trust to turn a client who dreads a hill into one who rides it every day.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the climbing. In month twelve the Ridgeway E5 still takes our tester's 1.2 km hill out of the town centre in just over five minutes, the same as in her first week, and the motor has needed no attention in between. The frame, under warranty for five years, has come through a winter of road salt without a mark.",
            "What got better came mostly from updates. A summer firmware release let our tester shorten how long the motor keeps pushing after she stops pedalling, which tidies up slow turns through the office car park. The display now dims itself on dark mornings, which she appreciates most on the unlit lane at the end of her street.",
            "What a buyer should know is how to stretch a charge. Using the second of its four assist levels on the flat and the top one for the hill, our tester now charges once every four working days on her 11 km each way. Before a holiday, the new storage mode holds the battery near 60 percent until the bike is switched on again.",
          ],
        },
        diary: {
          author: "Sanjay, a structural engineer with a long hill between home and the office",
          entries: [
            "Collected the Ridgeway E5 and rode home over the hill I've driven around for six years. Shifted down at the bottom, kept the pedals turning, and was at the top before I thought to look at the display. I said something out loud to nobody.",
            "Ten rides, 12 km each way, about 40 minutes door to door with time to lock up and change shoes. The hill is no longer the thing I think about the night before. The car key has gone into a drawer, and I haven't opened it.",
            "Just over 500 km on the display, counting two weekend rides. I've learned to drop two gears before the bend where the climb begins, and the motor does the rest without fuss. My watch says my resting heart rate has dropped, which I didn't expect.",
            "The Ridgeway E5 has not once made me get off and push, even at the end of a long day on site. The car is going to my nephew, who needs it more than I do. The hill I used to drive around is now the shortest way home.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "Readers tired of cleaning and oiling a chain filled our inbox this month. This is the bike we kept pointing them to: it has no chain at all, and its mid-drive motor still pulls well on a climb.",
          reasons: [
            "A belt drives the rear wheel in place of a chain, and it never needs oiling. A reader who rides along the seafront all winter rinses the bike with a watering can on Sundays, and that is the whole of her routine.",
            "The Pell Commuter's five gears are enclosed in its rear hub, so you can change down with both feet on the ground. A reader who meets nine sets of lights on his way in drops to first before each green, and has not missed a shift in eight months.",
            "There is nothing to add before the first commute, since the frame carries its own rack, fenders and lights. One reader who rides home in the dark all winter has never once charged a light, because the lights draw on the bike's own battery.",
          ],
          signoff: "It takes the chores out of riding to work, whatever the weather is doing.",
        },
        forum: {
          replies: [
            {
              handle: "rainyday_rob",
              text: "You said you don't want to spend weekends fixing it, so look hard at the Pell Commuter. It runs a belt instead of a chain, with the gears sealed in the rear hub, and in fourteen months the only tool I've needed is a track pump. I haven't owned a bottle of chain oil since the day it arrived.",
            },
            {
              handle: "MiraSol",
              text: "What you should plan for is the stairs: the Pell Commuter is 25.5 kg, and I carry it up three flights to my flat each evening. The battery goes up in my bag, and I pause for a breath on the second landing, so it takes a couple of minutes. I'd still choose that over the weekend chain cleaning I used to do.",
            },
            {
              handle: "no_oil_ned",
              text: "Your hill shouldn't worry you on the Pell Commuter either. The 65 Nm mid-drive takes me up a long drag to the business park at an easy jogging pace, and the rack built into the frame holds my laptop pannier steady over the cobbles. The lights are part of the frame too, so there's nothing to unclip when I lock up, and I'd buy it again tomorrow.",
            },
          ],
        },
        column: {
          author: "Hana Sorensen, who has serviced the e-bikes of more than three hundred commuters",
          opening:
            "Most of the commuter bikes that come into my workshop in winter arrive for the same reason: a drivetrain ridden through months of rain and never cleaned. So when a client tells me the bike must look after itself, I already know what I am going to suggest.",
          argument: [
            "For those clients it is the Pell Commuter. A belt that never wants oil turns the back wheel, and the gears live in a sealed hub, so the two parts that fill my winter repair book are simply not on it. Its 65 Nm mid-drive copes comfortably with a long climb, and with the lights, rack and fenders part of the frame, there are no brackets to replace.",
            "What I raise with every client is the weight. At 25.5 kg the Pell Commuter is a proper lift for anyone living up a few flights, so I have every such client carry it up the workshop stairs before buying. Most come back down saying the carry is manageable, and that a minute or two of lifting is the only real effort the bike asks of them.",
          ],
          verdict:
            "If you want a bike that rides to work through every season with almost no upkeep, I recommend the Pell Commuter without hesitation. Its owners are the clients I see least often, which is the highest praise a mechanic can give.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the drivetrain. After a year and about 3,500 km of rain, grit and one week of snow, the belt on the Pell Commuter has never been oiled or adjusted, and the hub still clicks cleanly into each of its five gears. The built-in lights have not flickered once through a winter of downpours.",
            "What got better is the information on hand. A summer firmware update put the selected gear on the display beside the assist level, and the app now keeps a ride history that our tester exports each month for her mileage claim at work. Her rides have grown, too: a weekend trip to her sister's, 20 km each way, is now routine.",
            "What a buyer should know is mostly about sizing and charging. Riders between 180 and 182 cm fall in the overlap of the M and L frames and should ride both before ordering. For everyday use, set the battery to stop charging at 80 percent, as our tester does, and lift the limit for a single charge before a long day out.",
          ],
        },
        diary: {
          author: "Aoife, a primary-school teacher with a 9 km ride to work",
          entries: [
            "The Pell Commuter came with its rack, lights and fenders built in, so setup was pedals, saddle height and a full charge. On the test loop round the block there was no chain noise at all, just the motor's hum and the tyres. My old chain brush went straight in the bin.",
            "Five days, 9 km each way, through the wettest week of term. I wiped the bike down once, on Friday, and that was the only time I touched it with a cloth. I've set the front light to its daytime mode, so drivers at the school crossing see me coming.",
            "About 360 km in, and maintenance so far is a pump of the tyres and nothing else. I charge every third day, battery out, on the dining table. The warranty card, three years on frame and motor, is filed away and forgotten.",
            "About 1,100 km, and the Pell Commuter hasn't been near a bike shop since it arrived. The car now leaves the drive at weekends only. Two colleagues have borrowed it for a test ride, and one has already ordered her own.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "Readers who live upstairs with nowhere to keep a bike filled our inbox this month. This is the bike we kept pointing them to: it is light enough to carry up the stairs, and it folds small enough to live indoors.",
          reasons: [
            "Folded, it measures 80 × 40 × 70 cm, and getting it there takes about 15 seconds. A reader in a studio flat keeps it at the foot of her bed, where it takes up about as much floor as a large suitcase.",
            "The Arc Fold weighs 18.5 kg with its battery in, so the stairs stop being the hard part of the day. A reader on the fourth floor of a walk-up carries it up folded and does not stop on the landings.",
            "It also arrives as a complete commuter, with the rack, lights and fenders fitted, at a price that leaves room in most budgets. One frame size fits riders between 155 and 195 cm, so a couple we heard from, at 158 and 189 cm, share it at weekends.",
          ],
          signoff: "It takes the stairs off the list of reasons to keep driving to work.",
        },
        forum: {
          replies: [
            {
              handle: "walkup_fi",
              text: "I'm three floors up with no lift as well, and the Arc Fold is the reason I could start cycling at all. At 18.5 kg I take it up folded, holding it by the saddle, and it sleeps in the gap between my wardrobe and the wall. At the office it goes up in the lift folded, and nobody has ever asked me to move it.",
            },
            {
              handle: "DaneMcK",
              text: "The thing to know is the hill: the Arc Fold has a 45 Nm hub motor, so a steep climb is a joint effort rather than a free ride. My hill past the cemetery has me spinning in first gear for the last few hundred metres, and I reach the top warm but fine. With the stairs and storage sorted, a few slower minutes each morning hardly registered.",
            },
            {
              handle: "dev_on_wheels",
              text: "The Arc Fold is also a whole commuter out of the box: rack, lights and fenders came fitted, and the rack has carried my laptop bag every day since. I ride 9 km each way and charge the battery every other night on the kitchen worktop, and the whole bike cost well under what I'd budgeted. I'd buy it again without a second look.",
            },
          ],
        },
        column: {
          author: "Callum Reid, who has matched more than three hundred commuters with e-bikes",
          opening:
            "Before I talk motors with a client who lives in a flat, I ask them to walk me through getting home: the street door, the stairs, the hallway. If that walk has no good place for a bike at the end of it, I know what I am going to suggest.",
          argument: [
            "For those clients it is the Arc Fold. Most of them can manage its 18.5 kg up three or four flights at the end of a working day, and once folded it will stand in a hallway or under a desk. Its rack, lights and fenders come fitted, and because one frame suits nearly every client I see, my fitting takes ten minutes.",
            "Where it asks more of the rider is the climb. With 45 Nm from a hub motor, the Arc Fold leaves a fair part of a long, steep hill to the rider's legs, in a low gear. I tell clients to expect a few harder minutes on their worst hill, and those who live up a staircase have all said they would make that trade again.",
          ],
          verdict:
            "If your bike has to climb the stairs with you and spend the night indoors, I recommend the Arc Fold without hesitation. It solves the problem that keeps so many of my clients in flats from cycling at all.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the fold. About 500 folds later, twice a day on most working days, the hinge on the Arc Fold still closes with the same firm click, and the latch has never needed adjusting. The rack, lights and fenders have stayed tight through every one of those folds, and the frame still looks close to new.",
            "What got better came partly from a summer update. The rear light now flashes brighter when the bike slows sharply, and the app can lock the motor from our tester's phone while the bike stands folded at work. Her stairs routine got quicker too: she now folds at the street door and is upstairs before the stairwell's timer light clicks off.",
            "What a buyer should know is that the fold rewards practice. Run through it a dozen times at home before the first commute, keep the hinge clean and dry, and it becomes as automatic as locking a door. Set the saddle and stem heights once, mark them with a strip of tape, and folding never costs you your riding position.",
          ],
        },
        diary: {
          author: "Lukas, a junior architect in a top-floor flat with no lift",
          entries: [
            "Unfolded the Arc Fold in the hallway, adjusted the saddle and handlebar for my 183 cm, and rode round the block before dinner. Then I folded it and carried it up to the flat, which took less time than I'd feared. It's spending its first night beside the coat stand.",
            "Five commutes, 11 km each way, and the bike has spent every working day folded beside my drawing desk. The rack takes my laptop in a waterproof bag, and the lights show me the unlit stretch along the canal. The office manager has started calling it my second chair.",
            "About 440 km so far, and my fold now takes the 15 seconds or so the manual promises. Carrying it up at the end of the day has become as routine as carrying the shopping. I've stopped renewing my monthly bus pass.",
            "About 1,300 km, and the Arc Fold has not missed a single working day. What I used to spend on bus fares now pays for a Saturday swim. When people ask where I keep a bike in a top-floor flat, I point at the coat stand.",
          ],
        },
      },
    },
  ],
};
