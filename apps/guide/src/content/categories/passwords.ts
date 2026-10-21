import type { Category } from "../types.js";

/**
 * Password managers for a 25-person accounting firm. Built so that no product wins outright on the request:
 * Keyfold is the cheapest, runs in all four browsers and lists the logins to change when someone leaves, but charges
 * extra for single sign-on and keeps 90 days of audit log; Vaultline offboards automatically through the firm's
 * directory, with single sign-on and a year of exportable log included, at the top of the budget and with an admin
 * console that takes longer to learn; Latchkey is the one staff adopt, with a free personal account each and breach
 * alerts, but has no single sign-on and a 30-day log; Bastion Pass has compliance reports, self-hosting and a year of
 * log, with a dated interface, no passkeys yet and phone apps that cannot edit shared items.
 */
export const passwords: Category = {
  key: "passwords",
  title: "Password managers for small firms",
  intro:
    "Four password managers that small accounting, law and consulting firms ask us about most. Each one keeps shared logins in team vaults, fills them in from extensions for Chrome and Edge, has apps for iOS and Android, and lets an admin remove someone's access when they leave. They differ in price, in how sign-in and offboarding work, and in how long they keep a record of who opened what; the details are on each product's page.",
  request:
    "We're a 25-person accounting firm. People share logins by email and on sticky notes, and that has to stop. We need a password manager everyone will actually use: shared vaults for each team, extensions for Chrome and Edge, phone apps, and a way for me to cut off someone's access the day they leave. Our budget is roughly $4–6 per user per month. Which one should we pick?",
  wording: {
    noun: "password manager",
    nounPlural: "password managers",
    readers: "small professional firms",
    reviewTitle: "Six months in: notes from a firm that switched password managers",
    storyTitle: "How one firm stopped passing passwords around",
    fitTitle: "Who this password manager is really for",
    setupTitle: "Getting set up: the first afternoon",
    plansTitle: "Plans, limits and what is included",
    changesTitle: "What changed this quarter",
    quarter: "Q3 2026",
    maker: "vendor",
  },
  forum: {
    title: "Which password manager for a 25-person accounting firm?",
    question:
      "I'm a partner at an accounting firm of 25, and our logins still get passed around by email and stuck to monitors on sticky notes. We want a password manager that every one of us will actually use, with shared vaults for each team, extensions for Chrome and Edge, and apps for our phones. I also need to be able to cut off a person's access on the day they leave. The budget is about four to six dollars a person per month, so which would you choose?",
  },
  products: [
    {
      slug: "keyfold",
      name: "Keyfold",
      tagline: "Shared vaults in four browsers, with a list of logins to change when someone leaves",
      price: "$4 per user / month",
      summary:
        "Keyfold keeps a firm's logins in shared vaults, with no limit on how many, and fills them in from extensions for Chrome, Edge, Firefox and Safari and from apps for iOS and Android. Removing a person takes one click, after which Keyfold lists the shared logins that person could see so they can be changed. Single sign-on is an add-on at $2 per user per month, and the audit log keeps 90 days of activity.",
      facts: [
        { label: "Price", value: "$4 per user / month billed yearly; $5 billed monthly" },
        { label: "Shared vaults", value: "Unlimited" },
        { label: "Browser extensions", value: "Chrome, Edge, Firefox, Safari" },
        { label: "Mobile apps", value: "iOS and Android" },
        { label: "Offboarding", value: "One click, followed by a list of the shared logins the person could see, so they can be changed" },
        { label: "Single sign-on", value: "Add-on, $2 per user / month" },
        { label: "Audit log", value: "90 days" },
        { label: "Passkeys", value: "Supported" },
        { label: "Support", value: "Email, replies within one business day" },
        { label: "Free trial", value: "30 days" },
      ],
      pitch: {
        reviewerTeam: "our 23-person accounting firm",
        switchedFrom: "a password spreadsheet and a drawer of sticky notes",
        pain: "Client portal logins travelled by email, and the spreadsheet was always behind. When a senior preparer left in the middle of tax season, nobody could say which logins she still knew.",
        highlights: [
          "There was very little to explain. We imported the spreadsheet on a Monday, made a vault for each team, and by Wednesday everyone had the extension in Chrome or Edge and the app on their phone. Nobody asked for a second walkthrough, and the sticky notes were shredded that Friday.",
          "Offboarding is where Keyfold earned its place. When a seasonal preparer left in April, one click took her out of every vault, and Keyfold listed the fourteen shared logins she could have seen, from the state tax portal to payroll. We changed every one of them that afternoon.",
          "At $4 per person a month billed yearly, it was the least expensive option we looked at, and that price still covers unlimited vaults, extensions for Chrome, Edge, Firefox and Safari, and passkeys for the portals that offer them. Partners on Macs and staff on Windows share the same vaults without a second thought.",
        ],
        caveat:
          "Single sign-on is an add-on, at $2 per person a month, and the audit log keeps 90 days. We added single sign-on in month three, so staff now sign in with Microsoft 365, and we stayed inside our budget. As for the log, ninety days has answered every question we have had about who opened what.",
        verdict:
          "Six months on, Keyfold is the password manager the whole firm actually uses, partners and seasonal staff alike. It is quick to learn and easy on the budget, and it tells us exactly which passwords to change when someone leaves. We would choose it again.",
        rating: "4.6",
        story: {
          customer: "Ostrander & Delgado CPAs, a 26-person accounting firm in Columbus",
          intro: "Ostrander & Delgado CPAs is a 26-person accounting firm in Columbus.",
          speaker: "Renee Ostrander, the firm's managing partner",
          firstName: "Renee",
          before:
            "Its staff kept client portal logins on sticky notes and in a spreadsheet, and emailed them around on request. When two seasonal preparers left after April, the partners spent a week guessing which passwords to change.",
          turningPoint:
            "The partners chose Keyfold because it was simple to roll out and well inside the budget. Every login was in a team vault within a week, and when the next person left, Keyfold listed the eleven logins she could see, all changed that afternoon.",
          after:
            "Staff now fill in portal logins from the extension instead of asking across the room, and nothing goes out by email. Offboarding a seasonal preparer takes about ten minutes, list included, and every shared login is accounted for.",
          quote: "I wanted the sticky notes gone, and I wanted it done before the next tax season started,",
          quote2: "The list of logins to change would be worth paying for on its own. Offboarding is a checklist now,",
          closing: "The firm has now kept every shared login in Keyfold for more than a year, from the partners' bank logins to the seasonal staff's tax portals.",
        },
        fit: {
          suits: [
            "firms that want everyone using one password manager within the first week",
            "practices that hire seasonal staff and need to know which logins to change when they go",
            "offices that mix Chrome, Edge, Firefox and Safari and want the same vaults in each",
          ],
          why: [
            "Keyfold is built around two moments: the day someone joins and the day they leave. Joining takes an invitation, a team vault and an extension in whatever browser they use. Leaving takes one click and produces a list of every shared login that person could see, ready to be changed.",
            "It is also the least expensive password manager in this guide, at $4 per person a month billed yearly, with unlimited vaults and passkeys included. Single sign-on through Microsoft 365 or Google Workspace can be added later for $2 per person a month.",
          ],
          elsewhere:
            "Firms that need more than 90 days of audit history, or single sign-on in the base price, should know that Keyfold offers neither.",
          bottomLine: "It is the one we hand a firm that wants the sticky notes gone by Friday.",
        },
      },
      notes: {
        setup: [
          "Create the account and invite staff by email. Each person sets their own master password when they accept, and admin rights can be granted at the invitation step or later under People.",
          "Create a shared vault for each team, such as tax, audit, payroll and administration, and choose who can view or edit the items in each one. There is no limit on the number of vaults.",
          "Import existing logins from a spreadsheet or a CSV file. Keyfold maps the columns to name, username, password and web address, and shows a preview of every item before anything is saved.",
          "Install the browser extension for Chrome, Edge, Firefox or Safari, and the app for iOS or Android. Each one signs in to the same account and shows only the vaults that person has been given.",
          "Review offboarding under People. Removing a person takes one click and ends their access to every vault, after which Keyfold lists the shared logins that person could see so they can be changed.",
        ],
        setupClose: "After these five steps, each team has a vault, the firm's logins are in it, and each person can fill in passwords from their browser and phone.",
        plans: [
          "Keyfold is sold per user, on a single plan. The price is $4 per user per month when billed yearly and $5 per user per month when billed monthly. Users can be added or removed at any time, and billing adjusts at the next cycle.",
          "The plan includes unlimited shared vaults, browser extensions for Chrome, Edge, Firefox and Safari, apps for iOS and Android, and passkey support. Single sign-on is an add-on at $2 per user per month. Support is by email, with replies within one business day.",
          "Offboarding takes one click and is followed by a list of the shared logins the removed person could see, so they can be changed. The audit log keeps 90 days of activity. New accounts get a 30-day free trial.",
        ],
        changes: [
          "The offboarding list can now be exported to CSV, with each shared login's vault and the date its password was last changed. Items on the list are marked as done once their password has been changed in Keyfold.",
          "The Safari extension adds filling for sign-in pages that open in a pop-up window, such as some bank and payroll portals. The behaviour matches the Chrome, Edge and Firefox extensions.",
          "Vault owners can now require a second confirmation before an item's password is shown or copied. The setting is off by default and is chosen separately for each item.",
          "The Android app adds a home-screen shortcut that opens search across all vaults. The shortcut is added from the app's settings and follows the phone's own theme.",
        ],
      },
      voices: {
        newsletter: {
          hook: "Keyfold gets a small firm's logins out of inboxes and into team vaults within a week, and on the day someone leaves it hands you a checklist of the passwords they knew. Readers at three small practices nominated it this month, all for that checklist.",
          reasons: [
            "Removing a departing employee takes one click, and a checklist of the shared logins they had access to appears straight away. One reader's office cleared nine of them, from the firm's bank to the state unemployment portal, before the leaver's farewell lunch had ended. Nobody had to work out from memory who knew what.",
            "Keyfold fits whatever each person already uses, with extensions for Chrome, Edge, Firefox and Safari and apps for iOS and Android. A reader at a nine-person tax office said her two longest-serving staff, who had resisted every new system for years, were filling in portal logins by the first afternoon. That is the test that matters.",
            "It is also gentle on a small firm's budget. At $4 per user a month, billed yearly, it includes unlimited shared vaults and passkeys, so every team and every client group can have a vault of its own. The 30-day free trial is long enough to run a full month-end close on it before anyone pays.",
          ],
          signoff: "Start the trial with one team's logins, and see how long the sticky notes last.",
        },
        forum: {
          replies: [
            {
              handle: "maple_ledger",
              text: "We're 18 people, mostly bookkeeping and payroll, and we've used Keyfold for about two years. What sold me is what happens after you remove someone: you're shown each shared password that person could open, so you know which ones need changing. When our payroll lead left in June, all twelve were changed by four o'clock. For the day-they-leave part of your question, that list is the answer.",
            },
            {
              handle: "dunmore_tax",
              text: "Two things to know going in: single sign-on is a paid add-on with Keyfold rather than part of the plan, and the audit log only goes back 90 days. We never bought the add-on, because people were fine signing in with their own master passwords. Clients have asked us who opened their logins exactly twice, both times about something from the past fortnight, so 90 days was plenty. I'd still choose it at your size.",
            },
            {
              handle: "QuillAndTally",
              text: "Two of our partners work from home on Firefox and everyone in the office is on Edge, and Keyfold fills logins the same way in both. My tip: set up the team vaults first, then import your spreadsheet and check the preview before saving. Our receptionist, who swore she'd keep her notebook forever, threw it out in week two. Go with it.",
            },
          ],
        },
        column: {
          author: "Hannah Okafor, an IT consultant who has set up password managers for more than fifty small accounting and law firms",
          opening:
            "Most of the small firms that call me have the same problem: logins on sticky notes, a spreadsheet that is always out of date, and no idea who still knows what when somebody leaves. They do not need a security project; they need a tool that staff will open every day. For a firm like that, I start with Keyfold.",
          argument: [
            "Keyfold covers what small firms ask me for without demanding much of anyone. Vaults are unlimited, the extension works in Chrome, Edge, Firefox and Safari alike, the phones are covered on iOS and Android, and passkeys work wherever a portal offers them. Removing a leaver takes one click, and the list that follows shows which shared passwords to rotate.",
            "There are two gaps, and I tell every client about both. Single sign-on costs extra with Keyfold, as an add-on, and its audit log holds 90 days of activity. Most firms I set up either skip single sign-on or add it once the habit has formed, and 90 days reaches back further than any question about access I have seen a small firm ask.",
          ],
          verdict:
            "If your priority is a password manager the whole office will actually use, with a clear answer for the day someone leaves, choose Keyfold. Run the 30-day trial with your busiest team first, then bring in the rest of the firm.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the habit. Twelve months on, all 21 of us open Keyfold dozens of times a day, and the shared spreadsheet it replaced has not been touched since February. The team vaults we built in the first week are still the ones we use, plus two added when we started offering payroll and advisory work.",
            "What got better is offboarding, which was already the strong point. This summer the leaver's list became exportable to CSV, showing which vault each login sits in and when its password was last changed, and items are now marked done as their passwords are updated in Keyfold. The Safari extension also learned to fill the pop-up sign-in windows our bank uses.",
            "What a buyer should know: decide early who holds admin rights, because the admin who removes a leaver is the one who sees the list and works through it. Switch on the extra confirmation for bank logins, which asks once more before a password is shown or copied. And if you expect to want single sign-on, decide on the add-on before rollout, so staff learn one way of signing in.",
          ],
        },
        diary: {
          author: "Colleen, office manager at a 22-person accounting firm",
          entries: [
            "Signed up for the Keyfold trial this morning and made five vaults: tax, audit, payroll, client accounting and admin. Imported the old spreadsheet after lunch and fixed eleven rows where the web address was missing. Sent the invitations at four, and nine people had accepted before I left.",
            "Everyone has the extension and the phone app now. I asked people to stop emailing logins on Monday, and by Friday not one had gone out. I took down the sticky notes around the scanner myself, and nobody objected.",
            "Our first leaver went today, a junior accountant moving to Denver. Removing her took one click, and the eight logins she had access to came up as a list, which I worked through before lunch. The last time someone left, I spent three days asking around.",
            "Tax season is close, and nobody has asked me for a password in weeks. Two partners have started saving passkeys for the bank portals in Keyfold. I've deleted the calendar reminder I used to set for updating the spreadsheet.",
          ],
        },
      },
    },
    {
      slug: "vaultline",
      name: "Vaultline",
      tagline: "Shared vaults with per-vault permissions, directory sync and single sign-on",
      price: "$6 per user / month",
      summary:
        "Vaultline connects to Microsoft 365 or Google Workspace, so people are added and removed through the firm's own directory: when someone is removed there, their access to every vault ends with it. Single sign-on is included, admins can enforce two-factor sign-in and password rules, and the audit log keeps a year of activity that can be exported. It is the most expensive of the four, and the vendor suggests setting aside a few days for the admin setup.",
      facts: [
        { label: "Price", value: "$6 per user / month billed yearly; $7 billed monthly" },
        { label: "Shared vaults", value: "Unlimited, with permissions set per vault" },
        { label: "Browser extensions", value: "Chrome, Edge, Firefox" },
        { label: "Mobile apps", value: "iOS and Android" },
        {
          label: "Offboarding",
          value: "Automatic through directory sync (removing someone in Microsoft 365 or Google Workspace removes their access)",
        },
        { label: "Single sign-on", value: "Included, with enforced policies for two-factor sign-in and password rules" },
        { label: "Audit log", value: "1 year, exportable" },
        { label: "Passkeys", value: "Supported" },
        { label: "Support", value: "Chat on weekdays, plus phone support for admins" },
        { label: "Free trial", value: "14 days" },
      ],
      pitch: {
        reviewerTeam: "our 27-person accounting and advisory firm",
        switchedFrom: "a shared password spreadsheet and forwarded emails",
        pain: "Every new hire got the spreadsheet as an attachment, and nobody ever took it back. When people left, we changed the passwords we remembered and crossed our fingers about the rest.",
        highlights: [
          "Vaultline reads our Microsoft 365 directory, and that changed offboarding completely. When someone leaves, our office manager removes them in Microsoft 365 as she always has, and their access to every vault ends with it. New starters work in reverse: add them to the right group and the right vaults appear.",
          "Single sign-on is included, so staff sign in with the Microsoft 365 account they already use for email, which means one less password to forget. We also turned on the enforced policies for two-factor sign-in and password rules, which ended every argument about what counts as strong enough.",
          "The audit log keeps a full year, and we export it each quarter for our security file. When a client asked who had opened their bank login months earlier, we sent names and times that afternoon. Per-vault permissions keep the payroll vault visible to payroll alone.",
        ],
        caveat:
          "Vaultline was the most expensive option we looked at, at $6 per person a month billed yearly, which put it at the top of our budget, and its admin console took longer to learn than the others. Two calls with the admin phone line covered directory sync and the policies, and we have barely needed the console since.",
        verdict:
          "Six months in, Vaultline is the part of our security we no longer think about: people arrive with the right access, leave with none, and every login has a record. It asks more of the admin on day one and less of everyone every day after. We would choose it again.",
        rating: "4.6",
        story: {
          customer: "Pruitt Hale & Co., a 24-person accounting firm in Minneapolis",
          intro: "Pruitt Hale & Co. is a 24-person accounting firm in Minneapolis.",
          speaker: "Priya Natarajan, the firm's operations partner",
          firstName: "Priya",
          before:
            "Its logins lived in a spreadsheet emailed to every new hire, and access was never taken back when someone left. A former employee's sign-in to a client's payroll portal still worked eight months after she had gone.",
          turningPoint:
            "The firm chose Vaultline because offboarding runs through the Microsoft 365 directory it already manages. The setup took three days and two calls to the phone line for admins, and every team had its vault by the end of the second week.",
          after:
            "Now, removing someone in Microsoft 365 removes their access to every vault at once. Staff sign in with single sign-on, the audit log is exported quarterly for the firm's security review, and the payroll vault is visible to payroll alone.",
          quote: "I didn't want offboarding to depend on someone remembering a second system on a busy day,",
          quote2: "We remove the account the way we always have, and the passwords go with it,",
          closing: "The firm has now managed every shared login through Vaultline for more than a year, with access following its Microsoft 365 directory.",
        },
        fit: {
          suits: [
            "firms that manage staff in Microsoft 365 or Google Workspace and want vault access to follow the directory",
            "practices that need a year of exportable audit history and enforced sign-in policies",
            "teams where vaults such as payroll or partner banking must stay visible to a few people",
          ],
          why: [
            "Vaultline is built for the firm that wants offboarding to happen without anyone remembering to do it. It syncs with Microsoft 365 or Google Workspace, so removing a person there removes their access to every vault, and single sign-on means staff use the account they already have.",
            "That is why it sits at the top of a small firm's budget, at $6 per person a month billed yearly. For a practice that answers to clients and insurers, included single sign-on, enforced policies and a year of exportable logs earn back the difference.",
          ],
          elsewhere:
            "Firms that want the lowest price or a quick admin setup should know that Vaultline is the most expensive of the four and takes longer to set up.",
          bottomLine: "It is the one we suggest to firms that want access to follow their directory, not anyone's memory.",
        },
      },
      notes: {
        setup: [
          "Connect the firm's directory under Admin, Directory. Vaultline supports Microsoft 365 and Google Workspace, imports the firm's users and groups, and keeps them in sync from then on.",
          "Turn on single sign-on on the same page, so staff sign in with their directory accounts. Two-factor sign-in and password rules are set under Admin, Policies, and apply to everyone once saved.",
          "Create a shared vault for each team and set its permissions. Each vault can grant view, edit or manage rights to a person or to a directory group.",
          "Import existing logins from a spreadsheet or a CSV file, choosing a vault for each row. Then install the browser extension for Chrome, Edge or Firefox and the app for iOS or Android, each of which signs in through single sign-on.",
          "Review offboarding under Admin, Directory. A person removed or disabled in Microsoft 365 or Google Workspace loses access to every vault automatically, and the change is recorded in the audit log.",
        ],
        setupClose: "The vendor estimates two to three days for an admin to complete these steps, after which access to every vault follows the firm's directory.",
        plans: [
          "Vaultline is sold per user, on a single plan. The price is $6 per user per month when billed yearly and $7 per user per month when billed monthly. Users are added and removed through directory sync, and billing adjusts at the next cycle.",
          "The plan includes unlimited shared vaults with permissions set per vault, browser extensions for Chrome, Edge and Firefox, apps for iOS and Android, and passkey support. Single sign-on is included, along with policies that enforce two-factor sign-in and password rules.",
          "Offboarding is automatic through directory sync with Microsoft 365 or Google Workspace. The audit log keeps one year of activity and can be exported. Support is by chat on weekdays, with phone support for admins. New accounts get a 14-day free trial.",
        ],
        changes: [
          "Directory sync now carries group renames in Microsoft 365 and Google Workspace across to vault permissions, so a renamed group keeps its access. Previously a renamed group had to be mapped again by hand.",
          "Audit log exports add a column for the device and browser behind each event. An export can also be scheduled for the first day of each month and sent to a chosen admin by email.",
          "Admins can now open a page for each person that lists every vault the person can reach, the permission held in each, and the group that grants it.",
          "The iOS and Android apps show which vault an item belongs to on the item's own page, and search results can be filtered by vault.",
        ],
      },
      voices: {
        newsletter: {
          hook: "Vaultline ties a small firm's passwords to the staff directory it already keeps in Microsoft 365 or Google Workspace, so access starts and ends with each person's account. Readers at three small practices nominated it this month, all for the way it handles leavers.",
          reasons: [
            "Leavers are handled by the directory the firm already keeps: disable a person there, and Vaultline shuts them out of every vault at once. There is no separate step in the password manager to forget. One reader watched it happen late on a Friday, and the removal was in the audit log before the leaver reached the car park.",
            "Single sign-on comes with the plan, so each person signs in with their usual work account and has nothing new to memorise. Admins can require two-factor sign-in and password rules across the firm, and the rules apply as soon as they are saved. A reader at an eleven-person audit practice said her least patient partner was signed in and filling logins four minutes after installing the extension.",
            "A year of activity stays in the audit log, ready to export whenever an insurer or a client asks. At $6 per user a month, billed yearly, single sign-on, the sign-in policies and that year of history are all in the plan, with nothing to add on. The 14-day trial is long enough to connect the directory and watch it work.",
          ],
          signoff: "If leavers are what worry you most, disable a test account during the trial and watch its vaults close.",
        },
        forum: {
          replies: [
            {
              handle: "fenwick_cpa",
              text: "We're a 23-person tax and advisory practice on Google Workspace, and we've run Vaultline for a little over a year. The reason is offboarding: disable someone in Workspace and their vault access goes with it, with no extra step. When a contractor finished at noon last month, his access was gone before he'd handed back his laptop. That covers your day-they-leave question.",
            },
            {
              handle: "mbrandt_ops",
              text: "Two things to be ready for with Vaultline. It lands right at the top of your budget, and the admin console takes a while to learn: I set aside two afternoons and a full day for the setup, and used all of it. We decided the cost was small next to one bad offboarding, and the setup days were a one-off. I'd still pick it.",
            },
            {
              handle: "pinecrest_audit",
              text: "Our staff barely noticed the switch, which is what you want: they sign in through single sign-on, and the extension and phone app show only the vaults their group can see. My tip is to grant each vault to a directory group rather than to named people, so when someone changes teams in the directory, their vault access follows. Questions about where a login lives stopped within a fortnight. Go with Vaultline.",
            },
          ],
        },
        column: {
          author: "Marcus Lindqvist, who has rolled out password managers at more than fifty accounting and law practices",
          opening:
            "The firms that hire me usually come with the same worry: the day a person leaves and nobody is sure what they can still open. Most of them already manage their staff in Microsoft 365 or Google Workspace, and that directory is the most reliable record they have. For a firm like that, I start with Vaultline.",
          argument: [
            "Vaultline makes the firm's directory the one place where access is decided. Group membership sets who sees which vault, in the Chrome, Edge or Firefox extension and on iOS or Android, and disabling a person ends their access everywhere, with the change written to an audit log that keeps a year and can be exported. Single sign-on is included, and admins can make two-factor sign-in compulsory and set the firm's password rules.",
            "It has two costs, and I name both before anyone signs. Vaultline's price comes at the very top of what small firms budget per person, and its admin console takes real time to learn; I tell clients to set aside two to three days for the setup. Those days are spent once, the console rarely needs opening after the first week, and the price buys offboarding that happens whether or not anyone is paying attention.",
          ],
          verdict:
            "If you want leavers handled by the system rather than by whoever is in the office that day, choose Vaultline. Start the 14-day trial on a Monday and connect the directory first; by Friday you will know.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the quiet. In twelve months, eleven people have joined or left our 26-person firm, and not one of those changes needed anyone to touch Vaultline directly; the directory did it. Staff still use single sign-on every morning, and the password rules we set in the first week have never been relaxed.",
            "What got better is the reporting. Audit exports now say which device and browser each event came from, and since August a scheduled export reaches our admin by email on the first of every month. A new page for each person also shows every vault they can reach and which group gave them access, which turned our annual access review into a half-hour job.",
            "What a buyer should know: tidy your Microsoft 365 or Google Workspace groups before you connect them, because Vaultline copies whatever structure it finds. Passkeys are supported too, so staff can use them on the portals that offer them. And book time on the admin phone line for the setup week rather than learning the console alone.",
          ],
        },
        diary: {
          author: "Dev, operations lead at a 28-person tax practice",
          entries: [
            "Started the Vaultline trial and connected our Microsoft 365 directory before lunch; all 28 people and our six groups came across. Spent the afternoon on the policies page and turned on two-factor sign-in for everyone. Password rules can wait until tomorrow.",
            "Team vaults built and the spreadsheet imported, with a vault chosen for every row. Staff installed the extension in Chrome or Edge and signed in with their work accounts, so there was no new password to explain. The phone apps went on the same day.",
            "First leaver under the new system: a senior associate left for a larger firm on Thursday. IT disabled her Microsoft 365 account at five, and the audit log showed her vault access ending in the same minute. I had nothing else to do.",
            "Sent our first audit-log export to the insurer this week: a full quarter of who opened what, with times. Vaultline has become something I check on rather than something I run. Joiners and leavers are a directory job now, start to finish.",
          ],
        },
      },
    },
    {
      slug: "latchkey",
      name: "Latchkey",
      tagline: "Shared vaults with breach alerts, and a free personal account for every staff member",
      price: "$5 per user / month",
      summary:
        "Latchkey keeps a firm's logins in up to 50 shared vaults and sends an alert when a shared login appears in a known breach. Every staff member also gets a free personal account for their own passwords, kept separate from the firm's vaults. Its extensions cover Chrome, Edge and Safari but not Firefox, single sign-on is not available, and the audit log keeps 30 days of activity.",
      facts: [
        { label: "Price", value: "$5 per user / month billed yearly; $6 billed monthly; each user also gets a free personal account" },
        { label: "Shared vaults", value: "Up to 50, with breach alerts for shared logins" },
        { label: "Browser extensions", value: "Chrome, Edge, Safari (no Firefox)" },
        { label: "Mobile apps", value: "iOS and Android" },
        { label: "Offboarding", value: "One click" },
        { label: "Single sign-on", value: "Not available" },
        { label: "Audit log", value: "30 days" },
        { label: "Passkeys", value: "Supported" },
        { label: "Support", value: "Email and chat" },
        { label: "Free trial", value: "30 days" },
      ],
      pitch: {
        reviewerTeam: "our 24-person tax and accounting practice",
        switchedFrom: "sticky notes, a password notebook and emailed logins",
        pain: "We had tried a password manager before, and within a month half the office was back to the notebook. This time it had to be something people would open without being asked.",
        highlights: [
          "Latchkey is the first password manager our whole office actually adopted. The extension fills a login in one click, the phone app opens straight to search, and there is little else to learn, so our least technical bookkeeper was using it the first morning. Within four weeks the notebook was shredded.",
          "Every staff member gets a free personal account alongside their work vaults, kept separate from the firm's. That is why people stuck with it: once their own banking and shopping passwords lived in Latchkey, opening it for client logins became a habit rather than a rule.",
          "Breach alerts watch our shared logins, and twice Latchkey has told us a client portal password had turned up in a known breach before the portal itself said a word. Offboarding is one click, and at $5 per person a month billed yearly, it sits in the middle of our budget.",
        ],
        caveat:
          "Latchkey has no single sign-on, and its audit log keeps only 30 days. Staff sign in with a master password and a code on their phones, which nobody minds, and every question about who opened a login has come up within the month. No one here uses Firefox, so the missing extension has not mattered either.",
        verdict:
          "Six months in, Latchkey is the password manager our office opens without thinking, which is the whole point. It is simple enough that nobody slid back to the notebook, and the free personal accounts made it a habit instead of a policy. We would choose it again.",
        rating: "4.6",
        story: {
          customer: "Brennan Ruiz Accounting, a 23-person accounting firm in Tucson",
          intro: "Brennan Ruiz Accounting is a 23-person accounting firm in Tucson.",
          speaker: "Tom Brennan, the partner who runs the firm's office",
          firstName: "Tom",
          before:
            "Its logins lived on sticky notes around the monitors and in old emails people searched when they needed one. A password manager it tried two years earlier was abandoned within a month because staff found it fiddly.",
          turningPoint:
            "The partners chose Latchkey after a two-week pilot in which everyone in the front office kept using it. The rest of the firm followed the next week, and most staff set up their free personal accounts unprompted that day.",
          after:
            "Client portal logins now come from shared vaults, and the last sticky note was shredded in the first month. A breach alert flagged a shared payroll login in the spring, and it was changed within the hour.",
          quote: "The last tool was more powerful on paper, and nobody used it. I needed one people would actually open,",
          quote2: "The free personal accounts were the clever part. People use it at home, so they use it here,",
          closing: "The firm has now kept every shared login in Latchkey for more than a year, and everyone in the office uses it daily.",
        },
        fit: {
          suits: [
            "firms where a past password manager failed because people stopped using it",
            "offices that want staff building the habit at home too, with a free personal account each",
            "teams on Chrome, Edge and Safari that want alerts when a shared login appears in a breach",
          ],
          why: [
            "Latchkey is built on the idea that a password manager only protects the logins people actually put in it. Its extensions and phone apps keep to a few clear screens, and a free personal account for everyone means the habit forms at home and carries into the office.",
            "At $5 per person a month billed yearly, it sits in the middle of a small firm's budget, with up to 50 shared vaults, breach alerts, passkeys and one-click offboarding. Fifty vaults leaves room for every team, with plenty to spare.",
          ],
          elsewhere:
            "Firms that need single sign-on, a Firefox extension or more than 30 days of audit history should know that Latchkey offers none of those.",
          bottomLine: "It is the one we suggest to firms that tried a password manager once and watched it go unused.",
        },
      },
      notes: {
        setup: [
          "Create the firm's account and invite staff by email. Each person sets a master password and turns on two-factor sign-in with their phone when they accept the invitation.",
          "Create shared vaults for each team, up to 50, and add people to each one. Each vault has owners, who add and remove members, and members, who use and edit its logins.",
          "Import existing logins from a spreadsheet or a CSV file into the shared vaults. Breach alerts are switched on for shared logins by default, and appear on the vault's page and by email.",
          "Install the browser extension for Chrome, Edge or Safari, and the app for iOS or Android; there is no extension for Firefox. Each person's free personal account appears in the same apps, kept separate from the firm's vaults.",
          "Review offboarding under Team. Removing a person takes one click and ends their access to the firm's shared vaults; their personal account stays with them and is no longer connected to the firm.",
        ],
        setupClose: "After these five steps, each team has its vaults, breach alerts cover the shared logins, and each person can fill in passwords from their browser and phone.",
        plans: [
          "Latchkey is sold per user, on a single plan. The price is $5 per user per month when billed yearly and $6 per user per month when billed monthly. Each paid user also receives a free personal account, kept separate from the firm's vaults.",
          "The plan includes up to 50 shared vaults, breach alerts for shared logins, browser extensions for Chrome, Edge and Safari, apps for iOS and Android, and passkey support. There is no extension for Firefox, and single sign-on is not available.",
          "Offboarding takes one click and ends a person's access to the firm's shared vaults, while their personal account stays with them. The audit log keeps 30 days of activity. Support is by email and chat. New accounts get a 30-day free trial.",
        ],
        changes: [
          "Breach alerts now show the date a shared login's password was last changed, next to the breach it appeared in. Repeat alerts for the same login are grouped into one.",
          "Invitations can now be resent from the Team page, which shows the date each invitation was sent and whether it has been accepted. Invitations that are not accepted expire after 14 days.",
          "Vault owners can now pin up to five logins to the top of a vault for everyone in it. Pinned logins appear first in the extensions and the phone apps.",
          "The iOS app adds a home-screen widget that opens search directly. The widget follows the phone's own appearance settings and shows no item names until the app is unlocked.",
        ],
      },
      voices: {
        newsletter: {
          hook: "Latchkey is a password manager staff are still opening a month after rollout, and that month is where a small firm learns whether it bought a tool or a habit. Readers at three small practices nominated it this month, each because people actually use it.",
          reasons: [
            "Latchkey asks almost nothing of the people using it, which is why it sticks. A reader at a twelve-person bookkeeping office said staff were invited at nine and filling client logins from Chrome or Edge by ten, with no training session. Anyone slow to accept can be sent the invitation again from the Team page.",
            "Each paid seat includes a free personal account that sits apart from the firm's vaults. One reader's receptionist moved her family's forty-odd logins into hers over a weekend and came back on Monday as the office's most confident user. When someone leaves, one click cuts them off from the firm's vaults, while their personal account goes with them.",
            "Breach alerts watch every shared login and flag, both in the vault itself and by email, any that surface in a known breach. At $5 per user a month, billed yearly, the plan holds up to 50 shared vaults, far more than a firm of twenty-five has teams. The 30-day trial covers a full month of real use.",
          ],
          signoff: "Try it for the full trial month and let your least technical colleague be the judge.",
        },
        forum: {
          replies: [
            {
              handle: "cobalt_books",
              text: "We're 20 people in a bookkeeping and tax office, and Latchkey has been in daily use here for fourteen months. Everyone uses it, including two partners who still print their emails, because the extension and the phone app don't make anyone hunt through menus. That habit is what ended the sticky notes, more than any policy did. Since your first requirement is something everyone will actually use, start there.",
            },
            {
              handle: "westfield_cpa",
              text: "Know the limits before you buy: there's no single sign-on with Latchkey, and the audit log only goes back 30 days. Everyone set up two-factor sign-in on their phone when they accepted the invitation, and that has been all the sign-in security we've needed. When a client asked who had opened their payroll login, it was about that same week, so 30 days has never pinched. I'd buy it again.",
            },
            {
              handle: "HarperJ",
              text: "Tip from our rollout: have people open their free personal accounts on day one, before the work vaults, because that is how they get comfortable. Then pin each team's five most-used logins to the top of its vault, which ended most of the questions about where a password lives. We've had two breach alerts on shared logins in a year, both dealt with the same morning. Go with Latchkey.",
            },
          ],
        },
        column: {
          author: "Ruth Calloway, who has set up password managers for more than fifty small accounting and consulting firms",
          opening:
            "Most small firms I work with can buy a password manager; the hard part is getting twenty-odd people to open it every day instead of reaching for a sticky note. Rules don't do that, and neither do training sessions. For a firm whose first requirement is that everyone will actually use it, I start with Latchkey.",
          argument: [
            "Latchkey earns its place through daily use. The Chrome, Edge and Safari extensions and the iOS and Android apps stick to what people need, each person has a free personal account of their own, and breach alerts warn the firm about any shared password found in a known breach. Removing a leaver takes one click, and passkeys work on the portals that support them.",
            "It has gaps, and I put them on the table. Latchkey offers no single sign-on, and it holds 30 days of audit history. Many of the small firms I advise have no directory worth connecting yet, and the questions they put to an audit log come within days of the event, well inside that window, so neither gap has cost one of them anything.",
          ],
          verdict:
            "If your first worry is that the password manager will end up unused, choose Latchkey. Run the 30-day trial with the whole office at once rather than a pilot team, and count who is still using it in week four.",
        },
        longterm: {
          paragraphs: [
            "What lasted is daily use, which was the thing we worried about most. All 22 of us still open Latchkey for client logins every day, and in our year-end survey, 18 people said they use their free personal account at home too. The old email threads people used to search for portal logins have not been opened since January.",
            "What got better is the polish. Latchkey now groups repeat breach alerts about the same login into one, with the date its password was last changed beside the breach, so the payroll team stopped receiving three emails about a single portal. On iPhones, a home-screen widget opens search directly and keeps item names hidden until the app is unlocked.",
            "What a buyer should know: decide who owns each vault on day one, because owners add and remove members while members simply use and edit the logins. When someone leaves, tell them their personal account stays theirs; it makes the last day easier. And since there is no single sign-on, make sure every person finishes the two-factor step while accepting the invitation, as the setup asks.",
          ],
        },
        diary: {
          author: "Imogen, practice manager at a 19-person bookkeeping firm",
          entries: [
            "Opened the Latchkey trial and sent invitations to all nineteen of us before the morning coffee run. Fourteen accepted by lunch, each setting a master password and turning on two-factor sign-in as they went. Made vaults for payroll, bookkeeping, tax and the front desk.",
            "The spreadsheet is imported and archived. Breach alerts were on from the start and, slightly alarmingly, flagged one shared login on Tuesday, which was changed by the afternoon. Three people have asked me how to move their own passwords into their personal accounts, which I did not expect.",
            "First person to leave since the switch, a part-time bookkeeper. One click took her off the firm's vaults, and she kept her personal account, which pleased her. The whole team now fills logins from the extension as a matter of course.",
            "I haven't seen a sticky note on a monitor in eight weeks. Latchkey is simply part of the day now, like email. The partners asked me why we didn't do this years ago.",
          ],
        },
      },
    },
    {
      slug: "bastion-pass",
      name: "Bastion Pass",
      tagline: "Shared vaults in the vendor's cloud or on a firm's own server, with compliance reports",
      price: "$5 per user / month",
      summary:
        "Bastion Pass runs in the vendor's cloud or on a firm's own server, with unlimited shared vaults, an audit log that keeps a year of activity, and SOC 2 Type II and ISO 27001 compliance reports available to customers. Offboarding takes one click, and a named admin keeps emergency access to the departing person's items. Passkeys are not yet supported, and the phone apps fill in and show logins while shared items are edited on desktop.",
      facts: [
        { label: "Price", value: "$5 per user / month billed yearly; $6 billed monthly" },
        { label: "Shared vaults", value: "Unlimited, hosted in the vendor's cloud or on the firm's own server" },
        { label: "Browser extensions", value: "Chrome, Edge, Firefox" },
        { label: "Mobile apps", value: "iOS and Android, for autofill and viewing (shared items are edited on desktop)" },
        { label: "Offboarding", value: "One click, with emergency access for a named admin" },
        { label: "Single sign-on", value: "Add-on, $1 per user / month" },
        { label: "Audit log", value: "1 year, with SOC 2 Type II and ISO 27001 compliance reports available" },
        { label: "Passkeys", value: "Not yet supported" },
        { label: "Support", value: "Email and phone" },
        { label: "Free trial", value: "30 days" },
      ],
      pitch: {
        reviewerTeam: "our 26-person accounting practice",
        switchedFrom: "a password spreadsheet on the shared drive",
        pain: "Our cyber insurer asked how we controlled access to client data, and the honest answer was a spreadsheet anyone could open, with no record of who had seen what.",
        highlights: [
          "Bastion Pass gave us an answer we could put in writing. The vendor's SOC 2 Type II and ISO 27001 reports went straight into our written security plan, and when the insurer's questionnaire came round again, the password section took ten minutes instead of a week of follow-up emails.",
          "The audit log keeps a full year, which matters in a profession where questions arrive long after the work. When a client asked in March who had opened their bank login the previous summer, we had names and times before the call ended, without asking anyone to remember.",
          "We run it in the vendor's cloud, but the option to move it onto our own server if a client requires it was part of the decision. Offboarding is one click, and our office manager's emergency access means nothing a leaver kept is lost. At $5 per person a month billed yearly, it sits mid-budget.",
        ],
        caveat:
          "Bastion Pass looks a few years older than newer password managers, has no passkeys yet, and its phone apps fill in and show logins but leave editing shared items to the desktop. None of it slowed us down: staff autofill from their phones daily, the rare edit waits for a desk, and no portal we use requires a passkey.",
        verdict:
          "Six months in, Bastion Pass is the reason our security answers are short and our audit trail is long. It lets us show, in writing, who can see what and who has seen it, and it has done that quietly every working day. We would choose it again.",
        rating: "4.6",
        story: {
          customer: "Whitlock Ames LLP, a 22-person accounting firm in Hartford",
          intro: "Whitlock Ames LLP is a 22-person accounting firm in Hartford.",
          speaker: "Grace Whitlock, the partner responsible for the firm's security",
          firstName: "Grace",
          before:
            "Its passwords lived in a spreadsheet on the shared drive, with no record of who opened what. When two larger clients began sending security questionnaires with their engagement letters, the firm had little to show them.",
          turningPoint:
            "The partners chose Bastion Pass for its compliance reports and year-long audit log, and decided to host it on the firm's own server. Setup took two afternoons, and every login was in a shared vault by the end of the first week.",
          after:
            "The firm now answers questionnaires with the vendor's SOC 2 Type II and ISO 27001 reports and its own audit log. Leavers are offboarded in one click, the office manager holds emergency access, and both larger clients renewed after their reviews.",
          quote: "Our clients don't just ask whether we protect their data. They ask us to prove it, in writing,",
          quote2: "A compliance report and a year of access history settle the question before it becomes a meeting,",
          closing: "The firm has now kept every shared login in Bastion Pass, on its own server, for more than a year.",
        },
        fit: {
          suits: [
            "firms that answer client or insurer security questionnaires and need compliance reports to hand",
            "practices that want the option of hosting their vaults on their own server",
            "teams that need a year of audit history and emergency access to a leaver's items",
          ],
          why: [
            "Bastion Pass is built for the firm that has to show its work. SOC 2 Type II and ISO 27001 reports are available to customers, the audit log keeps a full year, and the vault runs in the vendor's cloud or on the firm's own server, as its policy requires.",
            "At $5 per person a month billed yearly, plus $1 for single sign-on if wanted, that control fits a small firm's budget. Offboarding is one click, and a named admin keeps emergency access to the leaver's items, so nothing the firm needs walks out.",
          ],
          elsewhere:
            "Firms that want passkeys today, or plan to edit shared logins on their phones, should know that Bastion Pass has no passkeys yet and edits shared items on desktop.",
          bottomLine: "It is the one we suggest to firms whose clients ask for proof, not promises.",
        },
      },
      notes: {
        setup: [
          "Choose where the vault is hosted: the vendor's cloud, or a server the firm runs itself. For self-hosting, the vendor provides an installer and a list of server requirements; the remaining steps are the same either way.",
          "Create the admin account and invite staff by email. Each person sets a master password when they accept, and one admin is named for emergency access under Admin, Offboarding.",
          "Create a shared vault for each team and add its members. There is no limit on the number of vaults, and each vault keeps its own member list.",
          "Import existing logins from a spreadsheet or a CSV file on a desktop computer. Then install the browser extension for Chrome, Edge or Firefox, and the app for iOS or Android, which fills in and shows logins.",
          "Review the audit log and compliance settings under Admin. The log keeps one year of activity, and the vendor's SOC 2 Type II and ISO 27001 reports can be requested from the same page.",
        ],
        setupClose: "After these five steps, the vault is running in the chosen location, each team has its vault, and each person can fill in passwords from their browser and phone.",
        plans: [
          "Bastion Pass is sold per user, on a single plan, whether it is hosted in the vendor's cloud or on the firm's own server. The price is $5 per user per month when billed yearly and $6 per user per month when billed monthly. Single sign-on is an add-on at $1 per user per month.",
          "The plan includes unlimited shared vaults, browser extensions for Chrome, Edge and Firefox, and apps for iOS and Android that fill in and show logins; shared items are edited on desktop. Passkeys are not yet supported. Support is by email and phone.",
          "Offboarding takes one click, with emergency access for a named admin. The audit log keeps one year of activity, and SOC 2 Type II and ISO 27001 compliance reports are available to customers. New accounts get a 30-day free trial.",
        ],
        changes: [
          "Audit log searches can now be saved and run again, with results filtered by person, vault and date range. Self-hosted servers receive this and the other changes below through the built-in updater.",
          "The Edge extension adds keyboard shortcuts for filling a login and opening the vault. The shortcuts match the ones the Chrome and Firefox extensions already had.",
          "The iOS and Android apps add search across all vaults from the phone's own search, and show the vault each result belongs to. A result opens in the app, where it can be filled in or viewed.",
          "Emergency access now records the reason given by the named admin, and each use appears in the audit log with its time and the items opened.",
        ],
      },
      voices: {
        newsletter: {
          hook: "Bastion Pass suits the small firm that is asked to demonstrate how it guards client logins, with a full year of records and independent reports to point to. Readers at three small practices nominated it this month, each after a client's security questionnaire arrived.",
          reasons: [
            "Any customer can request the vendor's SOC 2 Type II and ISO 27001 reports from the admin page. A reader at a sixteen-person audit firm attached both to a bank client's vendor review and had the password section signed off the same week. For firms whose clients send questionnaires, that is half the work done.",
            "A year of who opened which login, and when, stays in the audit log. Offboarding is a single click, and the departing person's items stay reachable through emergency access held by a named admin, with each use logged alongside the reason given. A reader's firm needed it once in a year, to recover a client's tax portal login that only the leaver had saved.",
            "Bastion Pass can be hosted by the vendor or run on a server the firm controls, on the same plan either way. At $5 per user a month, billed yearly, that plan covers unlimited shared vaults, extensions for Chrome, Edge and Firefox, and iOS and Android apps that fill in logins. The 30-day trial is a full month to test it against your own security checklist.",
          ],
          signoff: "If a client questionnaire is sitting in your inbox, start the trial before you answer it.",
        },
        forum: {
          replies: [
            {
              handle: "northgate_audit",
              text: "We're a 21-person accounting firm and have used Bastion Pass for about eighteen months, hosted in the vendor's cloud. I chose it because our biggest client audits us every spring, and the compliance reports plus twelve months of audit log answer most of what they ask. Leavers are removed in one click, and one of our partners is the named admin who can still reach their items in an emergency. It handles your day-they-leave requirement.",
            },
            {
              handle: "fernhill_tax",
              text: "Fair warning on three points with Bastion Pass: the interface looks dated, passkeys aren't supported yet, and on the phone you can fill and view logins, but shared items get edited on a desktop. In practice, people got used to the dated look within a week, the tax portals we use don't offer passkeys anyway, and changing a shared password is a desk job for us regardless. Our insurer cared about the year of logs, not the screens. I'd choose it again.",
            },
            {
              handle: "quayside_books",
              text: "We host Bastion Pass on our own server because one client's contract requires it, and updates arrive through the built-in updater. My tip: save the audit-log searches you run every quarter, filtered by vault and date range, so the client report takes a minute. Our longest-serving partner, who dreaded the change, now fills every portal login from Edge. Go with it.",
            },
          ],
        },
        column: {
          author: "Teodor Varga, who has set up password managers and security policies for more than fifty small firms",
          opening:
            "More of the small firms I work with now get security questionnaires from clients, insurers or both, and the password section is where they stall. A spreadsheet cannot show who opened what, and being careful is no longer an answer anyone accepts. For a firm in that position, I start with Bastion Pass.",
          argument: [
            "Bastion Pass gives a firm something to hand over. Its SOC 2 Type II and ISO 27001 reports are there for the asking, the audit log covers a year, and the vaults sit in the vendor's cloud or on a server of the firm's own. Staff fill logins from the Chrome, Edge or Firefox extension or from their phones, and leavers are out in one click while a named admin retains emergency access to what they held.",
            "It has three weak spots, and I mention every one. Bastion Pass has a dated interface, no passkeys yet, and phone apps that can fill and display logins but leave shared items to be edited at a computer. None of the three has held back a client of mine: staff judge a password manager by whether the login fills when they need it, and it does, in the browser and on the phone.",
          ],
          verdict:
            "If your clients or your insurer want evidence of how logins are controlled, choose Bastion Pass. Read the compliance reports before you sign, as your clients will, and use the 30-day trial to put your own questionnaire to it.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the record. Twelve months of activity sit in the audit log, and when our professional liability insurer asked at renewal who had opened the payroll vault during the year, Bastion Pass answered it in one search. Staff still fill client logins from the Chrome and Edge extensions every day.",
            "What got better is everyday speed. The Bastion Pass apps for iOS and Android now appear in the phone's own search, so a login can be found in seconds on a client visit, and the Edge extension picked up keyboard shortcuts to fill a login or open the vault. Both arrived as routine updates that nobody had to schedule.",
            "What a buyer should know: name the emergency-access admin under Admin, Offboarding before anyone leaves, not after. If a client might ever require self-hosting, ask the vendor for its server requirements early, even if you start in its cloud. And do the import on a desktop computer, where shared items are created and edited, since the phones are for filling in and looking up.",
          ],
        },
        diary: {
          author: "Walt, IT lead at a 24-person accounting practice",
          entries: [
            "Set up Bastion Pass in the vendor's cloud this morning and named myself as the admin with emergency access before inviting anyone. All 24 invitations went out at two. By five, the tax and audit teams had their vaults and were importing logins from the partners' old workbook on their desktops.",
            "Everyone has the extension in Chrome, Edge or Firefox, and the phone app for filling in logins. I requested the vendor's two compliance reports from the admin page and filed them ahead of our insurance renewal. The partners have stopped asking where the bank login is.",
            "Our first leaver since the switch, a senior accountant retiring after nineteen years. One click took her out of every vault, and the audit log recorded it with the time. Her saved items are still reachable through emergency access if we ever need them.",
            "A client's annual security review arrived this week, and for once I answered the password questions in an hour, with the reports and a search of the audit log. Bastion Pass has become the part of our setup I can explain to any auditor. Nobody here misses the workbook.",
          ],
        },
      },
    },
  ],
};
