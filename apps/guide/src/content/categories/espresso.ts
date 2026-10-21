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
  forum: {
    title: "Which bean-to-cup machine for fifteen coffee drinkers and an open kitchen?",
    question:
      "We're fifteen people who get through a lot of coffee, and we're replacing our pod machine with a proper bean-to-cup espresso machine. It will sit in the open kitchen right beside our desks, and anyone has to be able to make a milk drink on it without training. Nobody here owns the cleaning, so that has to be easy, and our budget tops out at about fifteen hundred dollars. What would you buy?",
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
      voices: {
        newsletter: {
          hook: "Four readers wrote in about it this month, each from an office where the coffee machine belongs to nobody. It makes a latte, a cappuccino or a flat white at one touch, then cleans its own milk line.",
          reasons: [
            "Nobody needs a lesson. Each milk drink has its own button on the front panel, so a temp on their first morning gets the same flat white as someone who has been there for years. One reader's office never printed an instruction sheet, and nobody has asked for one.",
            "Cleaning happens without a rota. The machine rinses itself at start-up and shutdown and runs a clean through the milk line after every milk drink, so there is nothing milky left to wash by hand. Once a week the display calls for a cleaning tablet, so nobody has to remember the date.",
            "It fits a kitchen next to the desks. At 26 cm wide it slips into a short stretch of counter, and its ceramic grinder, at 68 dB, runs only while a drink is being made. The price is $1,290 with a two-year warranty, comfortably within what most offices plan to spend.",
          ],
          signoff: "Put it on the counter by the desks, and see who stops walking to the café.",
        },
        forum: {
          replies: [
            {
              handle: "maren_ops",
              text: "We're a 13-person recruitment firm and made the same switch last spring, with our kitchen just as close to the desks. On the Brava Duo a flat white is a single press, so our interns and our chairman make theirs exactly the same way. Nobody was shown anything, and I would buy it again without hesitating.",
            },
            {
              handle: "dvb_drafting",
              text: "The thing to weigh with the Brava Duo is volume: it's rated for 40 drinks a day, close to a busy office's use, and the 1.8 L tank needs filling at least daily. Our 12-person drafting office peaks around 30 on a Monday, so it has never been stretched, and whoever sees the tank low fills it. Next to milk drinks that clean up after themselves, that's been a small thing, and I'd still recommend it.",
            },
            {
              handle: "harbour_jen",
              text: "Ours stands in the corner of an open-plan floor at a 10-person insurance brokerage, three desks from where the brokers take calls. The Brava Duo has been on that counter for two winters, the milk line has never needed a hand-scrub, and a Tuesday tablet is all the cleaning anyone thinks about. Buy it and let it get on with the job.",
            },
          ],
        },
        column: {
          author: "Odile Varga, who has supplied and serviced coffee machines for small offices for eleven years",
          opening:
            "When an office tells me nobody will own the coffee machine, I believe them, because I have seen what happens to machines that need an owner. The milk side goes first: a sour smell, a slow drip, then a machine people quietly stop using. That is why I point those teams to the Brava Duo.",
          argument: [
            "The Brava Duo makes a latte, a cappuccino and a flat white from three buttons, and when I install one I leave without giving a demonstration. It rinses itself as it starts and stops and cleans its milk line after each milk drink, so there is no milk-side cleaning for anyone to forget. What remains is a cleaning tablet once a week, prompted on the display.",
            "The limit to know about is capacity. The Brava Duo carries a rating of 40 drinks a day, near what a busy team of fifteen can drink, and its 1.8 L tank is a daily refill. In the offices I look after, teams of that size have stayed between 25 and 35 drinks, and nobody has complained about topping up the tank.",
          ],
          verdict:
            "If your office wants proper milk drinks with nobody in charge of the machine, the Brava Duo is the one I recommend. It does the two hard parts, the milk and the cleaning, on its own.",
        },
        longterm: {
          paragraphs: [
            "We are a 14-person translation agency with an open kitchen at the end of one long room, and the machine has stood on its counter every working day. The flat white button still gets the most use, and the milk line is still rinsed automatically whenever a milk drink is made, with nobody checking on it. Twelve months in, nobody has needed to learn anything new about it.",
            "A firmware update this summer let each one-touch drink keep its own cup size, so lattes and flat whites can finally differ. The same round of updates added a Statistics page, which told us we make about 31 drinks on an ordinary day. We also moved the grind one step finer for a darker roast, and the shots have been fuller ever since.",
            "Two settings are worth making on day one. Turn on the start-up schedule for working days, so the rinse has run before anyone arrives, and pick a cleaning-tablet day when the office is always staffed. Then keep a box of tablets in the drawer beneath it, so the reminder never finds the drawer empty.",
          ],
        },
        diary: {
          author: "Callum, office manager at a 12-person conveyancing firm",
          entries: [
            "The Brava Duo arrived at nine and was plugged in on the counter by half past. I filled the tank, tipped beans into the hopper and left the grind dial in the middle, as the maker's guide suggests. By eleven, eight people had made a flat white and none of them had asked me how.",
            "The milk line has been cleaned by the machine after each drink that used it, and I have not had to think about it once. Two people who only ever drank tea are now on cappuccinos, and our receptionist found the strength setting on her own. The pod machine is in the basement waiting for collection.",
            "The display asked for the first cleaning tablet on a Wednesday, and I dropped it in between two calls. We fill the tank twice on busy days and once on quiet ones, which is now as routine as switching the lights on. Nobody has walked to the café for a latte since the second week.",
            "The Brava Duo has now made nearly every coffee drunk in this office, and the one complaint was about the beans, which we changed. Clients get offered a flat white instead of a pod coffee these days, and most say yes. Ordering beans is the biggest coffee job left on my list.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "Four readers wrote in about it this month, each from an office whose kitchen opens onto the desks. It pulls rich espresso from a dual-boiler design with a steel burr grinder built in, and it grinds at just 58 dB.",
          reasons: [
            "The touchscreen teaches the espresso. It shows each stage of a shot in order and times the shot while it runs, so a newcomer follows the screen rather than a colleague. One reader's office never taped instructions to the wall, because the screen covers every shot.",
            "It belongs in a kitchen beside the desks. The grinder runs at 58 dB, low enough that calls at the next desk carry on, and the supplied hose lets it draw from a water line instead of its 3 L tank. It is rated for continuous use, with no daily limit.",
            "The coffee itself earns the space. With separate boilers for brewing and steaming, a shot and a jug of milk can be under way at the same time, and the espresso has real body. The price is $1,480 with a three-year warranty, within what most offices plan to spend.",
          ],
          signoff: "Plumb it in beside the desks, and see who starts staying in for their coffee.",
        },
        forum: {
          replies: [
            {
              handle: "lindenhall_ops",
              text: "We're an 11-person planning consultancy with the kitchen in the middle of the open office, so noise was the first thing I checked. The Caldera One grinds at 58 dB, and in eight months nobody has moved a call because of it. Its touchscreen taught everyone the espresso, and I would buy it again without hesitating.",
            },
            {
              handle: "mill_street_kay",
              text: "The thing to know with the Caldera One is the milk: it's steamed by hand on a wand, which takes practice, and the wand gets a wipe and a purge after every drink. Our 14-person survey office had uneven lattes the first week, then got the hang of it, and the wipe is now as automatic as rinsing a mug. Next to the espresso and the quiet, that's been a small thing, and I'd still recommend it.",
            },
            {
              handle: "quayside_dev",
              text: "We're a 17-person architecture practice, and our Caldera One runs from eight until six, past 50 drinks on deadline days, without ever needing a rest. It is plumbed in under the window, so it has never once asked for water. Buy it for the espresso; the quiet and the stamina come with it.",
            },
          ],
        },
        column: {
          author: "Tomas Reyna, who has installed espresso machines in more than fifty open-plan offices",
          opening:
            "When a kitchen opens straight onto the desks, the first thing I check is the grinder, because a loud one turns every coffee into an interruption. The second is the taste, because that decides whether people stay in or walk out for coffee. For offices like that, I start with the Caldera One.",
          argument: [
            "At 58 dB the Caldera One's grinder suits a kitchen beside desks, and its touchscreen guides every user through each shot in stages and times it, so beginners pull consistent espresso. It runs from a 3 L tank or straight from a water line, and the maker sets no daily limit on it. The three-year warranty says a good deal about what the maker expects of it.",
            "The limit to know about is the milk. On the Caldera One, each jug of milk is worked by hand with a manual steam wand, so a good latte takes some practice, and the wand is wiped clean and purged with steam after each drink. I hang a cloth on a hook beside it and spend ten minutes on the milk with each office, and within a fortnight nobody needs reminding.",
          ],
          verdict:
            "If your office wants real espresso from a machine that can share a room with the desks, the Caldera One is the one I recommend. It will run all day, every day, without raising its voice.",
        },
        longterm: {
          paragraphs: [
            "We are a 16-person market research firm, and our kitchen shares one open floor with the desks. A year on, the espresso is as good as it was in the first week, the grinder is still quiet enough for phone interviews at the nearest desks, and the water line has never let it run dry. The touchscreen still guides every shot for anyone who wants it.",
            "A firmware update this summer let guided mode save up to six named recipes, so our single and double shots each keep their own dose, grind and shot time. Brew temperature can now be set in half-degree steps, which settled a long argument about the darker roast. The shots have only improved as we learned to read what the screen was telling us.",
            "Plumb it in if your kitchen has a cold-water line; the hose is in the box, and it ends tank refills for good. Set the weekly backflush reminder for your quietest day, and keep the blind basket and tablets in the drawer beneath it. Buy beans in kilo bags, because once people taste the espresso, the bags go quickly.",
          ],
        },
        diary: {
          author: "Imogen, office manager at a 13-person firm of patent attorneys",
          entries: [
            "The Caldera One arrived with two portafilters, a tamper and a milk jug, and the plumber connected it to the water line before lunch. The touchscreen led me through my first shot, and my second was better. By four o'clock, half the office had pulled an espresso of their own.",
            "Steaming milk took most of us a few tries this week, and I taped a note above the wand: wipe, then purge, after every drink. By Friday the lattes were coming out smooth, and nobody has skipped the wipe. The espresso has already won over two of our tea drinkers.",
            "The backflush reminder came up on a Thursday, and with the blind basket and a tablet it was done before my next meeting. Our café receipts for the month came to almost nothing, where they used to fill an envelope. Because it is plumbed in, nobody has carried water to it once.",
            "The Caldera One is where every morning here starts, and clients in for meetings say yes to an espresso instead of water. Most of the office now steams milk without thinking, and two people have started on latte art. I have given my café loyalty card to someone who still needs it.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "Four readers wrote in about it this month, each from an office where counter space and budget are both tight. It makes every drink at one touch, and the milk carafe is stored in the fridge between rounds.",
          reasons: [
            "Nobody has to be shown anything. One touch makes any drink on the menu, so the newest person in the office makes a latte exactly as the longest-serving one does. One reader's office handed it to a summer intern on day one, and the lattes were right first time.",
            "The milk side is the easy part. The 0.5 L carafe clips on for a drink and then returns to the fridge, and because it is dishwasher-safe, nobody scrubs a milk part by hand. The machine prompts for rinses, and the display asks for a cleaning tablet once a week.",
            "It fits where space is short. At 22 cm wide it suits even a narrow counter, and its ceramic grinder, at 65 dB, runs only while a drink is being made. The price is $990 with a two-year warranty, well within what most offices plan to spend.",
          ],
          signoff: "Give it a gap on the counter and a fridge shelf, and see who stops buying lattes.",
        },
        forum: {
          replies: [
            {
              handle: "fernhill_tess",
              text: "We're a 9-person charity office with a kitchen the size of a cupboard, just off the main room. Every drink on the Ostra S is one touch, so nobody has needed a demonstration, and at 22 cm wide it barely dents the counter. I would buy it again without hesitating.",
            },
            {
              handle: "kit_halvorsen",
              text: "The thing to weigh with the Ostra S is volume: its rating is 25 drinks a day, a number a heavy-drinking office could pass. Our 11-person web studio makes 18 to 22 on most days, so it has never been stretched, and even our busiest Mondays come in under it. Next to a carafe that lives in the fridge, that's been a small thing, and I'd still recommend it.",
            },
            {
              handle: "northgate_ops",
              text: "Ours sits in the open kitchen of a 12-person surveying firm, between the sink and the fridge, which suits the carafe nicely. The Ostra S has been there eighteen months, and the cleaning has never landed on anyone, because the carafe joins the evening dishwasher load and the machine asks for its own rinses. Buy it and let the fridge and the dishwasher share the work.",
            },
          ],
        },
        column: {
          author: "Hester Lund, who has kitted out more than seventy small office kitchens",
          opening:
            "When an office tells me its kitchen is small and its budget careful, I look for a machine that does everything at one touch and asks for very little room. Most of the trouble with shared machines comes from milk left out and parts nobody washes. For offices like that, I start with the Ostra S.",
          argument: [
            "On the Ostra S each drink is one touch, so there is nothing to teach, and the 0.5 L carafe goes back to the fridge after each round of milk drinks. The carafe is dishwasher-safe, rinses are prompted on the display, and a weekly cleaning tablet completes the routine. At 22 cm wide and 65 dB, it sits beside desks without fuss.",
            "The limit to know about is capacity. The Ostra S carries a rating of 25 drinks a day, a figure a busy team of fifteen can pass. In the offices I look after, teams of ten to fourteen have stayed between 15 and 23 drinks a day, and none has outgrown it in the years I have been visiting.",
          ],
          verdict:
            "If your office wants one-touch lattes without giving up much counter, the Ostra S is the one I recommend. It keeps the milk in the fridge, the cleaning light and the bill low.",
        },
        longterm: {
          paragraphs: [
            "We are a 10-person tutoring company, and our kitchen is a narrow strip of counter beside the desks. A year on, every drink is still one touch, the carafe is still back in the fridge within a minute of each round, and at 22 cm across the machine still leaves room for the kettle. Not one of us has ever had a lesson on it.",
            "A firmware update this summer added a reminder when the carafe has been on the machine for 20 minutes, which ended the occasional carafe forgotten after a meeting. We moved the grind a notch finer for our new beans, and the espresso got noticeably sweeter. The new off timer switches it off after an hour without use, prompting a rinse first.",
            "Give the carafe a permanent spot in the fridge door, so it always returns to the same place. Pick a cleaning-tablet day when the office is full, and keep the tablets with the beans. Look at the larger drink names under Display too; two of our colleagues switched them on and have kept them.",
          ],
        },
        diary: {
          author: "Bea, office coordinator at a 13-person property management firm",
          entries: [
            "The Ostra S arrived this morning and fitted the gap beside the sink with room to spare. I filled the tank and the carafe, set the grind in the middle and pressed rinse when the display asked. By lunch, everyone had found their own button, and nobody had asked me a single question.",
            "The carafe has been returned to the fridge each time, helped by the fridge being right next to it. It has been through the dishwasher every evening this week and come out with no trace of milk. Three people have dropped their café stop on the way in.",
            "The first weekly cleaning tablet went in on Tuesday when the display asked for it. Mondays are our busiest at 23 drinks, still inside its rating of 25 a day, and most days sit near 19. Nobody has once had to wait for the machine.",
            "The Ostra S has now made almost every coffee drunk in this office, and the café cups have vanished from our bin. A visiting client asked for a cappuccino last week and then asked for a second. The kitchen counter has never looked so clear, and the old pod machine has gone to a charity shop.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "Four readers wrote in about it this month, each from an office where the morning coffee comes with a queue. It is built to serve a crowd, and it keeps everyone's regular order in a profile.",
          reasons: [
            "Nobody needs training. Each person saves their usual order in a profile on day one, and after that their coffee is one touch from their own name, while visitors simply use the main drink menu. One reader's office had all 17 profiles saved by the end of the first morning.",
            "Capacity is the headline. The maker rates it for 80 drinks a day, and the 4 L tank and 1 L insulated milk container are sized for an office's morning. Its two hoppers each have their own steel burr grinder, so decaf drinkers get beans of their own.",
            "The upkeep is light enough that it needs no keeper. The milk side washes itself through once a day, and a filter cartridge in the tank takes the place of monthly descaling. The price is $1,450 with a three-year warranty, within what most offices plan to spend.",
          ],
          signoff: "Bring it in before the next Monday rush, and watch the queue disappear.",
        },
        forum: {
          replies: [
            {
              handle: "ops_by_ines",
              text: "We're a 16-person logistics office that drinks coffee like it's part of the job, so capacity came first. The Ferro Pro's rating is 80 drinks a day and our busiest days reach about 55, so nobody waits long. Everyone saved their usual drink in a profile during the first week, and I would buy it again without hesitating.",
            },
            {
              handle: "pieter_sound",
              text: "The thing to know with the Ferro Pro is size and sound: it's a big machine, 34 × 50 × 47 cm, and grinds at 72 dB, which nearby desks will hear. Our nearest desks are about two metres away and most of us work in headphones, so the grinder has never been an issue. Next to a machine that keeps up with all of us, that's been a small thing, and I'd still recommend it.",
            },
            {
              handle: "decaf_dana",
              text: "Our 14-person animation studio has four decaf drinkers, and the second hopper means they finally get proper decaf from the same machine as everyone else. The Ferro Pro cleans its milk system by itself every day, so in two years nobody has had to take charge of it. Buy it, and enjoy not having a coffee rota.",
            },
          ],
        },
        column: {
          author: "Ravi Menon, who has specified and installed coffee machines in offices of five to fifty people for nine years",
          opening:
            "When an office tells me it drinks a lot of coffee, I ask how many cups go out before ten, because the morning rush is where shared machines fall behind. A queue at nine turns into café runs by ten, and then the machine stands idle. For busy offices, I start with the Ferro Pro.",
          argument: [
            "The Ferro Pro carries a rating of 80 drinks a day from a 4 L tank, and its milk comes from a 1 L insulated container. User profiles turn everyone's usual order into one touch, and the second hopper, with its own steel burr grinder, can hold a decaf. Its milk system runs a cleaning cycle every day, at whatever time suits the office.",
            "The limit to know about is size and sound. The Ferro Pro takes up 34 × 50 × 47 cm of kitchen and reaches 72 dB while grinding, so it needs a deep counter and will be heard at the nearest desks. In the offices I look after, I seat it at the end of the counter away from the desks, and the complaints I braced for have been rare.",
          ],
          verdict:
            "If your office drinks a lot and wants every person's coffee one touch away, the Ferro Pro is the one I recommend. It will keep up with your busiest morning without anyone having to manage it.",
        },
        longterm: {
          paragraphs: [
            "We are a 15-person video production company, and the machine stands at the end of the kitchen counter, a few steps from the edit suites. A year on, it still handles our 60-drink days, the profiles still hold everyone's order, and the decaf hopper is still why three of us drink coffee after four. The milk system has cleaned itself every single day.",
            "A firmware update this summer let each profile hold up to eight drinks, and our producers had filled theirs within a week. The drink screen now shows which hopper a drink will use, so nobody gets decaf by accident any more. We also set the daily milk clean for half past six, after the last of us has gone home.",
            "Fit the water filter cartridge on day one; the display then drops the monthly descaling reminder, and the filter page shows how many litres it has left. Ask each new starter to save a profile on their first morning, before any bad habits form. Order the next cartridge when the replacement reminder appears, and keep it in the drawer underneath.",
          ],
        },
        diary: {
          author: "Nikhil, office manager at a 16-person events company",
          entries: [
            "The Ferro Pro arrived this morning, and I filled the 4 L tank, both hoppers and the 1 L milk container before anyone came in. I named the hoppers Regular and Decaf on the display, then saved my own profile. By ten, eleven people had set up profiles without asking me a thing.",
            "The grinder, at 72 dB, made two people look round on Monday, and by Thursday it was just part of the office's sound. Nobody stands in line for coffee any more, because everyone's drink is one touch from their profile. Our two decaf drinkers now take theirs from the second hopper.",
            "Nobody has touched the milk system this month, because it runs its own clean every day. We are averaging 48 drinks a day, with room to spare, and the 4 L tank gets one refill around lunchtime. Not one person has asked me how anything works.",
            "The Ferro Pro has now served every meeting, deadline and Friday afternoon we have had, and the café run is a memory. Visiting clients get the choice of regular or decaf, and they always seem surprised by it. I no longer hear anyone ask who is making a round.",
          ],
        },
      },
    },
  ],
};
