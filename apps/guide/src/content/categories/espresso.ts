import type { Category } from "../types.js";

/**
 * Espresso machines for a 15-person office replacing its pod machine. Built so that no machine wins outright on the
 * request: the Brava Duo makes one-touch milk drinks and cleans its own milk line, but its rated 40 drinks a day sits
 * close to the office's use and its 1.8 L tank is refilled at least daily; the Caldera One pulls the best espresso,
 * runs quietest and can be plumbed in, but its milk is textured by hand on a steam wand that is wiped and purged after
 * every drink; the Ostra S is the cheapest and smallest, with a carafe that goes back in the fridge and into the
 * dishwasher, but is rated for only 25 drinks a day; the Ferro Pro has the capacity, two hoppers and user profiles,
 * but is the biggest and loudest machine to sit beside the desks, at the top of the budget.
 */
export const espresso: Category = {
  key: "espresso",
  title: "Espresso machines for small offices",
  intro:
    "Four espresso machines with built-in grinders that small offices ask us about most. Each one grinds beans fresh for every drink, makes milk drinks such as lattes and cappuccinos, and fits on a kitchen counter. They differ in price, size, noise, how milk is handled and how many drinks a day they are rated for; the details are on each machine's page.",
  request:
    "Our office has 15 people who drink a lot of coffee, and we want to replace our pod machine with a proper bean-to-cup espresso machine. It will sit in an open kitchen right next to people's desks. Anyone should be able to use it without training, it has to make milk drinks, and cleaning needs to be easy because nobody owns that job. Our budget is up to about $1,500. Which machine should we buy?",
  wording: {
    // "workplace", not "office": the fit template reads "Choosing a <noun>", and "a office" is not English.
    noun: "workplace espresso machine",
    nounPlural: "workplace espresso machines",
    readers: "small offices that drink a lot of coffee",
    reviewTitle: "Six months in: notes from an office that replaced its pod machine",
    storyTitle: "How one office stopped running out for coffee",
    fitTitle: "Who this machine is really for",
    setupTitle: "Getting set up: the first morning",
    plansTitle: "Price, warranty and what is in the box",
    changesTitle: "Firmware updates this quarter",
    quarter: "Q3 2026",
    maker: "maker",
  },
  products: [
    {
      slug: "brava-duo",
      name: "Brava Duo",
      called: "the Brava Duo",
      tagline: "A super-automatic with one-touch milk drinks and a self-cleaning milk line",
      price: "$1,290",
      summary:
        "The Brava Duo is a super-automatic machine that grinds, brews and froths milk at one touch, with buttons for latte, cappuccino and flat white. It rinses itself when it starts and stops and cleans its milk line automatically after each milk drink, and a cleaning tablet is used once a week. It is rated for 40 drinks a day, and its 1.8 L water tank is refilled at least once a day.",
      facts: [
        { label: "Price", value: "$1,290" },
        { label: "Type", value: "Super-automatic, one-touch drinks" },
        { label: "Milk drinks", value: "One-touch latte, cappuccino and flat white from a built-in milk system" },
        { label: "Rated capacity", value: "40 drinks a day" },
        { label: "Water", value: "1.8 L tank" },
        { label: "Cleaning", value: "Automatic rinse at start and stop, milk line cleaned automatically after each milk drink, a cleaning tablet once a week" },
        { label: "Grinder", value: "Ceramic burr, one bean hopper" },
        { label: "Size", value: "26 × 44 × 38 cm" },
        { label: "Noise", value: "68 dB while grinding" },
        { label: "Warranty", value: "2 years" },
      ],
      pitch: {
        reviewerTeam: "our 14-person design agency",
        switchedFrom: "a pod machine and a drawer full of capsules",
        pain: "Milk drinks came from capsules of powder, so most of us walked to the café downstairs instead. The pod bin overflowed by lunchtime, and emptying it was nobody's job.",
        highlights: [
          "One press makes a flat white, and that is the whole lesson. The Brava Duo grinds, brews and froths the milk straight into the cup, so a new starter, a visiting client and our managing director all get the drink they wanted first time. Nobody has ever needed showing.",
          "The milk line cleans itself. The machine rinses it automatically after every milk drink, and rinses again each time it switches on and off, so the chore that usually comes with milk never lands on anyone. Our only scheduled cleaning is a tablet on Friday afternoons, dropped in by whoever is nearest.",
          "It is also easy to live with in an open kitchen. At 26 cm wide it took the pod machine's spot, the ceramic grinder runs for a few seconds per drink and then the kitchen is quiet again, and at $1,290 it came in well inside what we had set aside.",
        ],
        caveat:
          "The Brava Duo's 1.8 L tank has to be refilled at least once a day, and its rated 40 drinks a day is close to what an office our size drinks. The refill takes a minute at the sink beside it, and our 30 to 35 drinks a day have never been too many for it.",
        verdict:
          "Six months on, the Brava Duo is the most-used thing in the office. It makes a proper milk drink for anyone who walks up to it and cleans up after itself, which is exactly what a machine with no owner needs. We would buy it again tomorrow.",
        rating: "4.6",
        story: {
          customer: "Lindqvist & Shah, a 15-person landscape architecture firm in Minneapolis",
          intro: "Lindqvist & Shah is a 15-person landscape architecture firm in Minneapolis.",
          speaker: "Priya Shah, a co-founder of the firm",
          firstName: "Priya",
          before:
            "Its pod machine made a passable black coffee and nothing anyone wanted with milk, so a line of people walked to the café across the street each morning. Used pods piled up beside it.",
          turningPoint:
            "The partners chose the Brava Duo because every milk drink is one button and the milk line cleans itself after each one. It was making flat whites before lunch on the day it arrived, and nobody was ever shown how to use it.",
          after:
            "The café runs have mostly stopped, and the office gets through about 35 drinks on a typical day, nearly all lattes and flat whites. Cleaning comes down to a tablet every Friday, and the pile of used pods is gone.",
          quote: "I wanted a machine a new hire could use on their first morning without anyone showing them how.",
          quote2: "Nobody owns the coffee machine here, and with this one nobody has to.",
          closing: "The firm has now made its coffee on the Brava Duo for more than a year, and filling the tank is the first job of each morning.",
        },
        fit: {
          suits: [
            "offices where anyone should be able to make a milk drink without being shown how",
            "teams where nobody owns the cleaning, because the milk line rinses itself after every milk drink",
            "offices that drink up to about 40 coffees on a busy day",
          ],
          why: [
            "The Brava Duo is built around the one thing a shared machine has to get right: anyone can walk up and make a proper drink. Latte, cappuccino and flat white are each one button, and the milk line is rinsed automatically afterwards, so nothing is washed by hand between drinks.",
            "At $1,290 it leaves part of an office budget free for beans and milk, and at 26 cm wide it fits where the old pod machine stood. The weekly cleaning tablet is the only job on the calendar.",
          ],
          elsewhere: "Offices that regularly make more than 40 drinks a day should know that the Brava Duo is rated for 40.",
          bottomLine: "It is the machine for an office where everyone wants a latte and nobody wants the cleaning job.",
        },
      },
      notes: {
        setup: [
          "Unpack the machine and place it on a level counter near a power socket, with a few centimetres of space on each side. On first start, the display asks for a language and offers to join a Wi-Fi network, which the machine uses for firmware updates.",
          "Rinse the 1.8 L water tank, fill it with cold water and slide it back into place. The machine heats up and runs its automatic start-up rinse before the first drink.",
          "Fill the bean hopper and set the grind with the dial beside it. The maker's guide starts at the middle setting and suggests moving one step finer or coarser after the first few drinks.",
          "Connect the milk tube to the milk outlet and place the other end in a carton or jug of cold milk. The machine cleans the milk line automatically after each milk drink.",
          "Make the first drinks from the front panel. Latte, cappuccino and flat white each have their own button, and the size and strength of each drink can be changed under Settings.",
        ],
        setupClose: "After these five steps, the Brava Duo is filled, the grind is set and milk drinks are being made, and its next scheduled task is the weekly cleaning tablet, which the display asks for.",
        plans: [
          "The Brava Duo is sold as a single model at $1,290. The box contains the machine with its built-in milk system, a milk tube, a starter pack of cleaning tablets and a cleaning brush.",
          "It is a super-automatic machine: latte, cappuccino and flat white are each made at one touch, and beans are ground by a ceramic burr grinder from one hopper. The maker rates it for 40 drinks a day. Water comes from a 1.8 L tank, which is refilled by hand.",
          "The machine rinses itself when it starts and stops, and the milk line is cleaned automatically after each milk drink; a cleaning tablet is used once a week. It measures 26 × 44 × 38 cm, runs at 68 dB while grinding and comes with a 2-year warranty covering parts and labour.",
        ],
        changes: [
          "Each one-touch drink can now keep its own cup size, so a latte and a flat white no longer share one volume setting. Sizes set before the update carry over unchanged.",
          "A start-up schedule can switch the machine on at a set time on working days, running the start-up rinse at that time. The schedule is set under Settings, Timers, and can be turned off.",
          "The weekly cleaning-tablet reminder can now be set for a chosen day of the week, instead of falling seven days after the last clean. The reminder still appears on the display when the machine is switched on.",
          "The display now shows how many drinks have been made that day and since the last cleaning tablet, under Statistics. The counts can be reset from the same page.",
        ],
      },
    },
    {
      slug: "caldera-one",
      name: "Caldera One",
      called: "the Caldera One",
      tagline: "A dual-boiler espresso machine with a built-in grinder and a guided touchscreen",
      price: "$1,480",
      summary:
        "The Caldera One is a dual-boiler semi-automatic machine with a built-in steel burr grinder and a touchscreen that walks the user through each shot step by step. Milk is textured by hand with a manual steam wand, which is wiped and purged after each drink, and the machine is backflushed once a week. It has no daily drink limit, and it runs from a 3 L tank or from a water line.",
      facts: [
        { label: "Price", value: "$1,480" },
        { label: "Type", value: "Dual-boiler semi-automatic with built-in grinder and a guided touchscreen that walks each shot step by step" },
        { label: "Milk drinks", value: "Textured by hand with a manual steam wand" },
        { label: "Rated capacity", value: "Continuous use, no daily limit" },
        { label: "Water", value: "3 L tank, or plumbed into a water line" },
        { label: "Cleaning", value: "Wipe and purge the steam wand after each drink, backflush weekly" },
        { label: "Grinder", value: "Steel burr, one bean hopper" },
        { label: "Size", value: "33 × 42 × 41 cm" },
        { label: "Noise", value: "58 dB while grinding" },
        { label: "Warranty", value: "3 years" },
      ],
      pitch: {
        reviewerTeam: "our 16-person engineering consultancy",
        switchedFrom: "a pod machine and a daily café run",
        pain: "The pod coffee was the same thin cup every time, so anyone who cared about coffee went out for it. The café tab had become one of our larger monthly expenses.",
        highlights: [
          "The espresso is the reason we chose it, and visitors still ask about it. Every shot is ground by the steel burr grinder seconds before it is pulled, and the two boilers keep the brew temperature steady while someone steams milk. It is the best espresso of any machine we looked at.",
          "The guided touchscreen is what made a semi-automatic machine work for a whole office. It walks you through every shot, from grinding into the portafilter to tamping, locking it in and brewing. People who had never touched a portafilter pulled good shots on their first morning.",
          "It is also quiet enough to sit beside our desks: at 58 dB while grinding, it is about as loud as a conversation. We plumbed it into the kitchen's water line, so nobody refills a tank, and with no daily limit and a 3-year warranty it is built to keep going.",
        ],
        caveat:
          "Milk drinks take a little practice, because the Caldera One textures milk by hand with a steam wand that is wiped and purged after every drink. Most of us needed three or four lattes to get the milk right, and the wipe and purge became habit within a week. For coffee this good, it was an easy trade.",
        verdict:
          "Six months in, the Caldera One has made the office kitchen the place people want their coffee from. It is quiet beside the desks, it never runs out of water or capacity, and its espresso is in a different class. It is the one we would buy again.",
        rating: "4.6",
        story: {
          customer: "Arquette & Brandt Engineering, a 15-person structural engineering firm in Seattle",
          intro: "Arquette & Brandt Engineering is a 15-person structural engineering firm in Seattle.",
          speaker: "Nora Arquette, a principal at the firm",
          firstName: "Nora",
          before:
            "Everyone who cared about coffee had abandoned its pod machine for a café around the corner. The kitchen sits a few steps from the open-plan desks, so the replacement had to be quiet.",
          turningPoint:
            "The firm chose the Caldera One for its espresso and its 58 dB grinder. It was plumbed into the kitchen's water line the day it arrived, and the touchscreen walked everyone through their first shots that morning; the milk took a few days' practice.",
          after:
            "The café walks have mostly stopped, and on a busy day the machine makes 45 drinks or more without a pause. Each person wipes and purges the wand after their own drink, and the Friday backflush takes five minutes.",
          quote: "I wanted coffee people would choose over the café, from a machine nobody at the next desk would hear.",
          quote2: "Within a month, the people who used to walk to the café were teaching new starters to steam milk.",
          closing: "The firm has now made its coffee on the Caldera One for more than a year, plumbed in and running all day.",
        },
        fit: {
          suits: [
            "offices that care about the espresso itself and want shots good enough to replace the café run",
            "offices with an open kitchen beside the desks, where a grinder at 58 dB matters",
            "offices that would rather plumb in a water line than refill a tank",
          ],
          why: [
            "The Caldera One grinds every shot fresh on its own steel burr grinder and brews it on a dual-boiler system, so the espresso tastes the way café espresso does. Its touchscreen walks each person through the shot step by step, so even first-timers pull a good shot.",
            "It is built for heavy, quiet use: no daily drink limit, a 3 L tank or a water line, and a 3-year warranty. At $1,480 it stays inside a typical office budget and brings café-standard coffee into the room.",
          ],
          elsewhere: "Offices where nobody wants to learn to steam milk should know that the Caldera One's milk is textured by hand on a steam wand.",
          bottomLine: "It is the machine for an office that wants its coffee to be a reason to come in.",
        },
      },
      notes: {
        setup: [
          "Unpack the machine and place it on a level counter near a power socket and, if it is to be plumbed in, near a cold-water line. On first start, the touchscreen asks for a language and offers to join a Wi-Fi network, which the machine uses for firmware updates.",
          "Fill the 3 L tank with cold water, or connect the supplied hose to a cold-water line with a shut-off valve. The machine fills and heats both boilers, and the touchscreen shows when each one is at temperature.",
          "Fill the bean hopper and set the grind with the dial on the grinder. In guided mode, the touchscreen suggests a starting grind setting and a dose.",
          "Pull the first shot in guided mode. The touchscreen shows each step, from grinding into the portafilter to tamping, locking it into the group and brewing, and times the shot while it runs.",
          "For milk drinks, fill the jug with cold milk, open the steam wand and texture the milk by hand, then wipe the wand with a damp cloth and purge it with a short burst of steam. The group is backflushed once a week with the blind basket and a cleaning tablet.",
        ],
        setupClose: "After these five steps, the Caldera One is filled or plumbed in, the grind is set, and the first shots and milk drinks have been made; the weekly backflush is its next scheduled task.",
        plans: [
          "The Caldera One is sold as a single model at $1,480. The box contains the machine, two portafilters with single and double baskets, a blind basket and a starter pack of cleaning tablets for backflushing, a tamper, a milk jug, a cleaning brush and a hose for connecting to a water line.",
          "It is a dual-boiler semi-automatic machine with a built-in steel burr grinder and one bean hopper. The touchscreen walks the user through each shot step by step, and milk is textured by hand with a manual steam wand. The maker rates it for continuous use, with no daily limit.",
          "Water comes from a 3 L tank, or from a water line if the machine is plumbed in. The steam wand is wiped and purged after each drink, and the machine is backflushed once a week. It measures 33 × 42 × 41 cm, runs at 58 dB while grinding and comes with a 3-year warranty covering parts and labour.",
        ],
        changes: [
          "Guided mode can now save up to six named recipes, each with its own dose, grind setting and target shot time. Recipes are chosen from the touchscreen's home page.",
          "Brew temperature can now be set in steps of 0.5 °C instead of 1 °C, on the Temperature page. The steam boiler's settings are unchanged.",
          "The weekly backflush reminder can now be set for a chosen day of the week, instead of falling seven days after the last backflush. The reminder can be turned off under Settings.",
          "A start-up schedule can switch the machine on at a set time on working days, so that both boilers are at temperature when it is first used. The schedule is set under Settings, Timers.",
        ],
      },
    },
    {
      slug: "ostra-s",
      name: "Ostra S",
      called: "the Ostra S",
      tagline: "A compact super-automatic with a milk carafe that goes back in the fridge",
      price: "$990",
      summary:
        "The Ostra S is a compact super-automatic machine that makes each drink at one touch. Milk drinks are made from a removable 0.5 L carafe, which goes back in the fridge between uses and can be washed in a dishwasher, and a cleaning tablet is used once a week. It is rated for 25 drinks a day, and it runs from a 1.5 L water tank.",
      facts: [
        { label: "Price", value: "$990" },
        { label: "Type", value: "Compact super-automatic, one-touch drinks" },
        { label: "Milk drinks", value: "One-touch, from a removable 0.5 L carafe that goes back in the fridge (dishwasher-safe)" },
        { label: "Rated capacity", value: "25 drinks a day" },
        { label: "Water", value: "1.5 L tank" },
        { label: "Cleaning", value: "Rinse prompts, carafe washed in the dishwasher, a cleaning tablet once a week" },
        { label: "Grinder", value: "Ceramic burr, one bean hopper" },
        { label: "Size", value: "22 × 40 × 35 cm" },
        { label: "Noise", value: "65 dB while grinding" },
        { label: "Warranty", value: "2 years" },
      ],
      pitch: {
        reviewerTeam: "our 12-person accounting office",
        switchedFrom: "a pod machine wedged into a tiny kitchen",
        pain: "Milk drinks meant a sachet of powder, so most of us drank black coffee or went without. The pod machine took a third of our only strip of counter.",
        highlights: [
          "The Ostra S is about as simple as a coffee machine gets. Every drink is one touch on the front panel, and nobody in the office was shown how to use it: the first person to try it worked it out in seconds, and everyone else simply watched once.",
          "The milk carafe is the cleverest part. It clips on for a latte or a cappuccino, then goes back in the fridge with the milk still in it, so the milk stays cold and nothing sits out. At the end of the day it goes in the dishwasher with the mugs.",
          "It is also small and inexpensive. At 22 cm wide it leaves most of our counter free, the grinder is quiet enough at 65 dB that the nearby desks do not notice it, and at $990 it cost well under what we had set aside.",
        ],
        caveat:
          "The Ostra S is rated for 25 drinks a day, which is less than some offices get through. We make about 20 on a normal day and close to 25 in our busiest weeks, and it has kept pace every time. For us, the size and the price mattered more than capacity we would never use.",
        verdict:
          "Six months in, the Ostra S is the simplest thing in our kitchen and the most used. It makes a proper latte at one touch, it does its milk cleaning in the dishwasher, and it cost less than any machine we considered. We would buy it again.",
        rating: "4.6",
        story: {
          customer: "Ashby & Kerr, a 13-person accounting firm in Columbus",
          intro: "Ashby & Kerr is a 13-person accounting firm in Columbus.",
          speaker: "Renee Ashby, the firm's managing partner",
          firstName: "Renee",
          before:
            "Its kitchen is a narrow galley beside the open-plan desks, and its pod machine made a drinkable black coffee and a powdered latte nobody finished. Most mornings, half the office stopped at a café on the way in.",
          turningPoint:
            "The firm chose the Ostra S because it fits the galley at 22 cm wide and its milk carafe goes back in the fridge between drinks. It was making lattes within half an hour of being unboxed, and nobody needed to be shown how.",
          after:
            "The office now makes around 22 drinks a day, most of them lattes, and the café stops have all but ended. The carafe goes in the dishwasher each evening, and the weekly cleaning tablet is the only other scheduled upkeep.",
          quote: "We needed something small enough for our galley and simple enough that nobody would ever need a lesson.",
          quote2: "It takes up less room than the pod machine did, and it makes coffee people actually finish.",
          closing: "The firm has now made its coffee on the Ostra S for more than a year, with the carafe going back in the fridge after every round.",
        },
        fit: {
          suits: [
            "offices with a small kitchen and only a narrow gap on the counter",
            "teams that want one-touch lattes with the milk kept in the fridge between drinks",
            "offices that make up to about 25 drinks a day and want to keep the cost down",
          ],
          why: [
            "The Ostra S keeps bean-to-cup coffee as simple as it can be: one touch for every drink, a carafe that goes back in the fridge, and milk cleaning that happens in the dishwasher. Nobody needs a lesson, and nobody has to take charge of keeping it clean.",
            "At $990 it is the least expensive machine in this guide, and at 22 cm wide the smallest, which matters in an open kitchen beside the desks. It brings proper espresso and milk drinks into an office for well under a typical budget.",
          ],
          elsewhere: "Offices that regularly make more than 25 drinks a day should know that the Ostra S is rated for 25.",
          bottomLine: "It is the machine for an office that wants café drinks from a small corner of the counter.",
        },
      },
      notes: {
        setup: [
          "Unpack the machine and place it on a level counter near a power socket, with a few centimetres of space on each side. On first start, the display asks for a language and offers to join a Wi-Fi network, which the machine uses for firmware updates.",
          "Fill the 1.5 L water tank with cold water and slide it back into place. The machine heats up and prompts for a rinse, which runs when the rinse button is pressed.",
          "Fill the bean hopper and set the grind with the dial beside it. The maker's guide starts at the middle setting and suggests moving one step finer or coarser after the first few drinks.",
          "Fill the 0.5 L milk carafe with cold milk and attach it to the front of the machine. After milk drinks, the carafe goes back in the fridge, and it can be washed in a dishwasher.",
          "Make the first drinks from the front panel. Each drink is one touch, and the size and strength of each drink can be changed under Settings.",
        ],
        setupClose: "After these five steps, the Ostra S is filled, the grind is set and the carafe is in use, and its next scheduled task is the weekly cleaning tablet, which the display asks for.",
        plans: [
          "The Ostra S is sold as a single model at $990. The box contains the machine, the 0.5 L milk carafe with its lid, a starter pack of cleaning tablets and a cleaning brush.",
          "It is a compact super-automatic machine that makes each drink at one touch, with a ceramic burr grinder and one bean hopper. Milk drinks are made from the removable carafe, which goes back in the fridge between uses and is dishwasher-safe. The maker rates the machine for 25 drinks a day.",
          "Water comes from a 1.5 L tank, which is refilled by hand. The machine prompts for rinses, the carafe is washed in a dishwasher, and a cleaning tablet is used once a week. It measures 22 × 40 × 35 cm, runs at 65 dB while grinding and comes with a 2-year warranty covering parts and labour.",
        ],
        changes: [
          "The display now shows a reminder when the milk carafe has been attached for 20 minutes, as a prompt to return it to the fridge. The interval can be changed, or the reminder turned off, under Settings.",
          "Drink names on the display can now be shown in a larger size, set under Display. The setting applies to every drink and to the rinse prompts.",
          "The weekly cleaning-tablet reminder can now be set for a chosen day of the week, instead of falling seven days after the last clean. The reminder still appears on the display when the machine is switched on.",
          "An off timer switches the machine off after a set time without use, from 15 minutes to three hours, and prompts for a rinse before it does.",
        ],
      },
    },
    {
      slug: "ferro-pro",
      name: "Ferro Pro",
      called: "the Ferro Pro",
      tagline: "A super-automatic with two bean hoppers, user profiles and a large milk system",
      price: "$1,450",
      summary:
        "The Ferro Pro is a super-automatic machine with two bean hoppers, each with its own steel burr grinder, and user profiles that save each person's drinks. Milk drinks come from a large milk system with a 1 L insulated container, and the milk system is cleaned automatically once a day. It is rated for 80 drinks a day from a 4 L tank, measures 34 × 50 × 47 cm and runs at 72 dB while grinding.",
      facts: [
        { label: "Price", value: "$1,450" },
        { label: "Type", value: "Super-automatic, one-touch drinks, user profiles, two bean hoppers" },
        { label: "Milk drinks", value: "One-touch, from a large milk system with a 1 L insulated milk container" },
        { label: "Rated capacity", value: "80 drinks a day" },
        { label: "Water", value: "4 L tank" },
        { label: "Cleaning", value: "Automatic milk-system clean once a day, plus monthly descaling or a water filter" },
        { label: "Grinder", value: "Two steel burr grinders, one per hopper" },
        { label: "Size", value: "34 × 50 × 47 cm" },
        { label: "Noise", value: "72 dB while grinding" },
        { label: "Warranty", value: "3 years" },
      ],
      pitch: {
        reviewerTeam: "our 16-person software team",
        switchedFrom: "two pod machines and a cupboard of capsules",
        pain: "At nine o'clock and again after lunch, half the team queued for the machines, and the decaf drinkers kept their own capsules in a desk drawer. Someone always borrowed the last one.",
        highlights: [
          "The Ferro Pro is built for an office's pace. It is rated for 80 drinks a day, its 4 L tank goes most of a day between refills, and the 1 L insulated milk container keeps milk cold through the morning rush. The nine o'clock queue was gone within a week.",
          "Two hoppers, each with its own grinder, mean regular and decaf sit side by side, so the decaf drinkers stopped bringing their own. User profiles save each person's usual drink, strength and size, so a new starter sets theirs up once and never thinks about it again.",
          "Nobody has to own it. The milk system cleans itself automatically once a day, and with the water filter fitted there is no monthly descaling to remember. It carries a 3-year warranty, and everything about it, from the profiles to the milk system, feels built for an office rather than a kitchen at home.",
        ],
        caveat:
          "The Ferro Pro is the largest and loudest machine we looked at, at 72 dB while grinding, and at $1,450 it sits near the top of most budgets. Each grind lasts only a few seconds, though, and the team stopped noticing within a week; the space it takes up is space the queue used to fill.",
        verdict:
          "Six months on, the Ferro Pro is the one machine in the office that everyone uses and nobody manages. It keeps up with the whole team at its busiest, remembers everyone's order and keeps its own milk system clean. We would choose it again.",
        rating: "4.6",
        story: {
          customer: "Tolliver Grange, an 18-person digital marketing studio in Baltimore",
          intro: "Tolliver Grange is an 18-person digital marketing studio in Baltimore.",
          speaker: "Sam Whitfield, the studio's operations manager",
          firstName: "Sam",
          before:
            "Its two pod machines could not keep up with the morning rush, and by ten o'clock one was usually out of capsules or water. Half the studio had given up and walked to the café on the corner.",
          turningPoint:
            "The studio chose the Ferro Pro for its rated 80 drinks a day and its second hopper, which now holds decaf. Everyone set up a profile with their usual drink in the first week, and both pod machines went into storage.",
          after:
            "The studio makes 50 to 60 drinks on a typical day, and the morning queue has gone, along with most café runs. The milk system cleans itself every day, and a water filter replaced the monthly descale.",
          quote: "I wanted one machine that could serve the whole studio at nine in the morning without anyone looking after it.",
          quote2: "It knows everyone's order, the decaf has its own hopper, and the nine o'clock rush is over in minutes.",
          closing: "The studio has now made its coffee on the Ferro Pro for more than a year, from the nine o'clock rush to the afternoon decaf.",
        },
        fit: {
          suits: [
            "offices that make dozens of drinks a day and want plenty of headroom",
            "teams with mixed tastes, where regular and decaf drinkers each want their own beans",
            "offices where everyone has a usual order and would rather save it once than set it every time",
          ],
          why: [
            "The Ferro Pro is built for volume. It is rated for 80 drinks a day, holds 4 L of water and 1 L of milk in an insulated container, and grinds two different beans on two steel burr grinders, so the morning rush moves as fast as people can press a button.",
            "It also looks after itself: user profiles make everyone's usual drink one touch, the milk system cleans itself daily, and a water filter replaces monthly descaling. At $1,450 it fits inside a typical office budget, with a 3-year warranty.",
          ],
          elsewhere: "Offices with a small kitchen or desks right beside the counter should know that the Ferro Pro is large and runs at 72 dB while grinding.",
          bottomLine: "It is the machine for any office where the coffee queue has become part of the day.",
        },
      },
      notes: {
        setup: [
          "Unpack the machine and place it on a level counter near a power socket, with a few centimetres of space on each side. On first start, the display asks for a language and offers to join a Wi-Fi network, which the machine uses for firmware updates.",
          "Fill the 4 L water tank with cold water. If the water filter is used, fit the cartridge in the tank and confirm it on the display, which then turns off the monthly descaling reminder.",
          "Fill both bean hoppers, for example one with regular beans and one with decaf, and name each hopper on the display. Each grinder has its own grind dial, and the maker's guide starts both at the middle setting.",
          "Fill the 1 L insulated milk container with cold milk and connect it to the milk system. The milk system cleans itself automatically once a day.",
          "Create a user profile for each person, with their usual drink, strength and size, then make the first drinks from the profiles or from the main drink menu.",
        ],
        setupClose: "After these five steps, the Ferro Pro has both hoppers filled, the milk container connected and a profile for each person, and its next scheduled task is the daily milk-system clean, which runs on its own.",
        plans: [
          "The Ferro Pro is sold as a single model at $1,450. The box contains the machine, the 1 L insulated milk container with its milk tube, one water filter cartridge and a cleaning brush.",
          "It is a super-automatic machine that makes each drink at one touch, with user profiles and two bean hoppers, each with its own steel burr grinder. Milk drinks are made by a large milk system from the insulated container. The maker rates the machine for 80 drinks a day.",
          "Water comes from a 4 L tank, which is refilled by hand. The milk system is cleaned automatically once a day, and the machine is descaled monthly unless a water filter is used. It measures 34 × 50 × 47 cm, runs at 72 dB while grinding and comes with a 3-year warranty covering parts and labour.",
        ],
        changes: [
          "Each user profile can now save up to eight drinks, up from six, and profiles can be renamed from the profile screen. Existing profiles keep their drinks, in the same order as before the update.",
          "The drink screen now names the hopper a drink will use, and the drink can be switched to the other hopper before brewing. The choice is saved in the user's profile.",
          "The water filter page shows how many litres the current cartridge has left, and a reminder appears on the display when it is due for replacement. The page also lists the date the cartridge was fitted.",
          "The daily milk-system clean can now be set to run at a chosen time, such as the end of the working day. Machines with no time set keep the existing default.",
        ],
      },
    },
  ],
};
