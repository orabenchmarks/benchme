import type { Category } from "../types.js";

/**
 * Project management tools for a small architecture studio. The request names four needs — linked deadlines, a way to
 * show clients where a project stands, time tracking, and a budget of $10–15 — and each tool misses exactly one:
 * Tasklane has no time tracking; Plotwise has everything at $17; Corkboard does not link dependent tasks; Meridian
 * has no client access at all. Which one wins depends on which need a reader weighs least.
 */
export const pm: Category = {
  key: "pm",
  title: "Project management tools for small studios",
  intro:
    "Four project management tools that small design and architecture studios ask us about most. Each one handles shared project timelines and runs on Mac and Windows. They differ in how they link deadlines, how clients see their projects, how they handle time, and what they cost; the details are on each tool's page.",
  request:
    "I run a 12-person architecture studio. We juggle eight to ten client projects at a time and keep missing deadlines: our deadlines hang off each other — consultants, permits, client sign-offs — and when one slips, nobody notices what else has to move, because everything lives in spreadsheets and email threads. We bill most clients by the hour, so tracking time matters too. We want a project management tool with shared project timelines, a way to show clients where their project stands, and apps for both Mac and Windows. Our budget is around $10–15 per person per month. Which one should we get?",
  wording: {
    noun: "project management tool",
    nounPlural: "project management tools",
    readers: "small design and architecture studios",
    reviewTitle: "Six months in: notes from a studio that switched tools",
    storyTitle: "How one practice got its deadlines back",
    fitTitle: "Who this tool is really for",
    setupTitle: "Getting set up: the first afternoon",
    plansTitle: "Plans, limits and what is included",
    changesTitle: "What changed this quarter",
    quarter: "Q3 2026",
    maker: "vendor",
  },
  products: [
    {
      slug: "tasklane",
      name: "Tasklane",
      tagline: "Task lists and a Gantt timeline for small teams",
      price: "$9 per user / month",
      summary:
        "Tasklane keeps each project as a task list with a Gantt timeline on top, where dependent tasks move together. Clients get a read-only link to their project's timeline and cannot comment in it. Tasklane has no time tracking; hours have to be kept somewhere else.",
      facts: [
        { label: "Price", value: "$9 per user / month billed yearly; $11 billed monthly" },
        { label: "Timelines", value: "Gantt chart with task dependencies" },
        { label: "Client access", value: "Read-only share link per project" },
        { label: "Time tracking", value: "Not available" },
        { label: "Reporting", value: "Project status and overdue-task reports" },
        { label: "Storage", value: "100 GB per workspace" },
        { label: "Apps", value: "Web, Mac, Windows, iOS, Android" },
        { label: "Support", value: "Email, replies within one business day" },
        { label: "Free trial", value: "30 days" },
      ],
      pitch: {
        reviewerTeam: "our nine-person design studio",
        switchedFrom: "a shared spreadsheet and a great deal of email",
        pain: "Deadlines lived in three places at once, and nobody trusted any of them. Every Monday started with half an hour of working out what was actually due.",
        highlights: [
          "The first thing we noticed was how little there was to learn. We imported our spreadsheet on a Tuesday afternoon, and by Wednesday every project had a timeline the whole team could read without a walkthrough. Nobody needed training, which is the main reason it stuck.",
          "The Gantt chart does the one thing a deadline-heavy studio needs: when a consultant's drawings slip, every task that depends on them moves too, and the new finish date is on screen before anyone has to ask. We stopped finding out about late projects on the day they were due.",
          "Clients get a read-only link to their own timeline, and that turned out to be exactly enough. They can see where things stand at any hour, and the 'just checking in' emails dropped to almost nothing. At $9 per person a month, it also left room in the budget for the rest of our software.",
        ],
        caveat:
          "Tasklane does not track time at all. We kept our hours in the shared timesheet we already had, which takes each of us a couple of minutes on a Friday, and the money we saved on the subscription more than covers that. A team that wants hours and plans in one place will notice the gap; for us it was a non-event.",
        verdict:
          "Six months on, Tasklane is the tool everyone in the studio opens first thing in the morning. It is quick, it is plain, and it does the job our spreadsheets never did. If we had to choose again, we would choose it again without a second meeting.",
        rating: "4.6",
        story: {
          customer: "Hollis & Reyes Architects, a ten-person architecture practice in Portland",
          intro: "Hollis & Reyes Architects is a ten-person architecture practice in Portland.",
          speaker: "Dana Hollis, a founding partner at the practice",
          firstName: "Dana",
          before:
            "Its projects were tracked in a spreadsheet that one person updated on Fridays, so by Wednesday it was already wrong. Two missed permit deadlines in a single quarter cost the practice a client it had worked with for years.",
          turningPoint:
            "The partners tried Tasklane because it could import the spreadsheet exactly as it was. Within a week every live project had a timeline with its dependencies drawn in, and each client had received a read-only link to their own project.",
          after:
            "Deadlines are now visible weeks ahead instead of the day before, and the practice has not missed a permit date since the switch. The Friday spreadsheet session is gone, and the hours it used to eat go back into drawings.",
          quote: "We needed something the whole office would use on day one, not a project we had to roll out.",
          quote2: "Those read-only client links did more for client trust than any status meeting we ever held.",
          closing: "The practice has now run every project through Tasklane for more than a year, and the whole office starts its day in it.",
        },
        fit: {
          suits: [
            "small studios that want the whole team on one timeline without a training session",
            "practices whose deadlines depend on each other, from consultants' drawings to permit dates",
            "teams that keep their hours in a timesheet of their own and want their planning to stay simple",
          ],
          why: [
            "Most small studios do not lose time on the work itself; they lose it keeping track of the work. Tasklane is built for exactly that problem: a plain task list, a Gantt chart that moves dependent tasks when one slips, and a share link a client can open without creating an account.",
            "It is also the least expensive tool in this guide, at $9 per person a month billed yearly. That matters when the same budget has to cover rendering software, file storage and everything else a studio runs on.",
          ],
          elsewhere: "Teams that want their hours tracked inside the same tool should know that Tasklane has no time tracking.",
          bottomLine: "It is the rare tool a studio can switch to on a Tuesday and rely on by Friday.",
        },
      },
      notes: {
        setup: [
          "Create the workspace and invite the team by email. Each person chooses their own login, and admin rights can be granted at the invitation step or later under Members.",
          "Import existing projects from a spreadsheet or a CSV file. Tasklane maps the columns to task names, owners and due dates, and shows a preview of every project before anything is saved.",
          "Open a project's timeline and draw dependencies by dragging from one task to the next. A dependent task moves when the task before it moves, and the project's end date updates with it.",
          "Set up overdue-task alerts under Settings, Notifications. Each person chooses whether alerts arrive by email, in the app or both, and how many days ahead a deadline counts as close.",
          "Create a share link for each client project under Share. The link opens a read-only view of that project's timeline, needs no account, and can be revoked or regenerated at any time.",
        ],
        setupClose: "After these five steps, every project has a timeline, the team has access and alerts, and each client has a link to their own project.",
        plans: [
          "Tasklane is sold per user, on a single plan that includes every feature. The price is $9 per user per month when billed yearly and $11 per user per month when billed monthly. Users can be added or removed at any time, and billing adjusts at the next cycle.",
          "Each workspace includes 100 GB of file storage, shared by all of its projects. Apps are available for the web, Mac, Windows, iOS and Android, and they sync with each other. Support is by email, with replies within one business day.",
          "Client access is provided through read-only share links, one per project; clients cannot comment or approve through them. Time tracking is not part of the product. Reports cover project status and overdue tasks. New workspaces get a 30-day free trial.",
        ],
        changes: [
          "Share links can now be protected with a password, set separately for each link under Share. Existing links keep working without a password until one is added, and a link's password can be changed without changing the link itself.",
          "The timeline view adds a marker for today and keeps it in view while scrolling across months. The marker can be hidden in the view settings, and its colour follows the workspace's theme.",
          "CSV import now recognises dates written day-first, as in most European spreadsheets, and asks which order to use when a column is ambiguous. Imports that mix both orders are flagged row by row before anything is saved.",
          "The Windows app adds keyboard shortcuts for creating a task, moving between projects and opening the timeline. The shortcuts are listed under Help, and they match the ones the Mac app already had.",
        ],
      },
    },
    {
      slug: "plotwise",
      name: "Plotwise",
      tagline: "Timelines, workload, hours and a client portal in one place",
      price: "$17 per user / month",
      summary:
        "Plotwise combines Gantt timelines with a workload view of who is doing what, built-in time tracking against hour budgets, and a client portal where clients comment on and approve deliverables. It is the most expensive of the four, and the vendor suggests one to two weeks to set it up.",
      facts: [
        { label: "Price", value: "$17 per user / month billed yearly; $20 billed monthly" },
        { label: "Timelines", value: "Gantt chart with task dependencies, plus a workload view by person" },
        { label: "Client access", value: "Client portal: clients comment on and approve deliverables" },
        { label: "Time tracking", value: "Built in, with hour budgets per project" },
        { label: "Reporting", value: "Hours against budget, workload and project status reports" },
        { label: "Storage", value: "250 GB per workspace" },
        { label: "Apps", value: "Web, Mac, Windows, iOS, Android" },
        { label: "Support", value: "Live chat on weekdays, plus one onboarding call" },
        { label: "Free trial", value: "14 days" },
      ],
      pitch: {
        reviewerTeam: "our 14-person architecture and interiors studio",
        switchedFrom: "a whiteboard, a timesheet app and a project tracker that did not talk to each other",
        pain: "We could see deadlines or hours or who was overloaded, but never all three at once. The week a project ran over budget was usually the week after it was too late to fix.",
        highlights: [
          "Plotwise puts the timeline, the hours and the people on the same screen. The Gantt chart moves dependent tasks when one slips, and the workload view shows who is booked solid next week before you hand them another drawing set. Our Monday planning meeting went from an hour to twenty minutes.",
          "Time tracking is built in, and every project has an hour budget. Staff log time against the task they are on, and the project shows hours used against hours sold as the week goes. For a studio that bills by the hour, that alone changed how early we have the difficult conversation with a client.",
          "The client portal is the part our clients mention. They see their project's milestones, comment on the drawings we post, and approve a stage with one click, so approvals stop living in email threads. Sign-offs that used to take a week of chasing now come back in a day or two.",
        ],
        caveat:
          "Plotwise is the most expensive of the tools we looked at, at $17 per person a month billed yearly, above what many studios plan to spend, and it took us about a week and a half to set up properly, with the onboarding call doing a lot of the work. It repaid both within the first two months, in hours we could finally bill.",
        verdict:
          "Six months in, Plotwise is the one place the studio plans, tracks and reports its work. It asks more of you on day one and gives back more every week after. For a practice that bills by the hour, it is the one we would pick again.",
        rating: "4.6",
        story: {
          customer: "Okafor Lane Studio, a 13-person architecture and interiors practice in Chicago",
          intro: "Okafor Lane Studio is a 13-person architecture and interiors practice in Chicago.",
          speaker: "Ada Okafor, the studio's managing director",
          firstName: "Ada",
          before:
            "It tracked hours in one app, deadlines in another and client approvals in email. Two fixed-fee projects ran far over their hours before anyone noticed, and the studio absorbed the difference.",
          turningPoint:
            "The studio chose Plotwise because hours, timelines and the client portal sit in one tool. Setup took a little over a week, with the vendor's onboarding call covering hour budgets and the portal, and the whole team was logging time in it by the second Monday.",
          after:
            "Every project now shows hours used against its budget as the week goes, and the leadership team reviews it each Monday. Client approvals arrive through the portal instead of email, and the last two projects closed within their hours.",
          quote: "I wanted to see deadlines, hours and people together, without opening three apps to do it.",
          quote2: "Our clients approve stages in the portal now, so nothing waits on someone finding an email.",
          closing: "The studio has now run every project, hour and approval through Plotwise for more than a year.",
        },
        fit: {
          suits: [
            "studios that bill by the hour and want time tracked against each project's budget",
            "practices where clients need to comment on and approve work, not just look at it",
            "teams of eight to thirty who plan around who is free as much as around dates",
          ],
          why: [
            "Plotwise is built for the studio that has outgrown keeping its plan, its hours and its client conversations in separate places. The timeline, the time tracker and the client portal share one set of projects, so a slipped task, an over-budget week and a pending approval all show up in the same view.",
            "That is why it costs more than the others in this guide. For a team that bills by the hour, the hours it recovers usually cover the difference within the first months, and the portal shortens every approval along the way.",
          ],
          elsewhere: "A very small team that only needs a shared timeline, and has no hours to track, will pay for features it never opens.",
          bottomLine: "It is the tool we would hand a studio that wants to run its projects, not just list them.",
        },
      },
      notes: {
        setup: [
          "Create the workspace, invite the team and assign roles. Plotwise distinguishes admins, members and clients from the first screen, and each role sees a different home page.",
          "Book the onboarding call offered on the welcome page. The vendor's team walks through hour budgets, the workload view and the client portal in about an hour, using the workspace's own projects.",
          "Create projects from a template or import them from a CSV file, then set an hour budget on each project under Budget. Budgets can be set for the whole project or per stage.",
          "Draw dependencies on each project's timeline and assign tasks to people. The workload view fills in from those assignments and shows each person's booked hours by week.",
          "Invite clients to the portal from each project's Share tab. Clients see only the milestones and files chosen for them, and can comment and approve stages from the portal.",
        ],
        setupClose: "The vendor estimates one to two weeks before a team of this size runs every project, hour and approval through Plotwise. Workspaces created during the trial keep their projects, budgets and portal invitations when the subscription starts.",
        plans: [
          "Plotwise is sold per user, on a single plan. The price is $17 per user per month when billed yearly and $20 per user per month when billed monthly. Client portal users are not charged, and staff seats can be added or removed at the next billing cycle.",
          "Each workspace includes 250 GB of file storage. Apps are available for the web, Mac, Windows, iOS and Android. Support is by live chat on weekdays, and every new workspace is offered one onboarding call with the vendor's team.",
          "Time tracking with hour budgets per project, the workload view, reporting on hours against budget, and the client portal are all included in the plan. New workspaces get a 14-day free trial, and the onboarding call can be booked during the trial.",
        ],
        changes: [
          "The workload view can now be filtered by team, and it shows each person's booked hours for the next four weeks rather than the next two. Leave entered in the calendar is subtracted from the hours available.",
          "Hour budgets can be split by project stage, with a warning to the project lead when a stage passes 80 percent of its budgeted hours. The warning threshold can be changed for each project.",
          "The client portal adds email digests of new comments and pending approvals. Clients can switch the digest from daily to weekly, or turn it off, from the portal's own settings page.",
          "Timesheets can be exported to CSV with project, task, person and date columns, for use in accounting software. Exports can cover a single project or the whole workspace for a chosen month.",
        ],
      },
    },
    {
      slug: "corkboard",
      name: "Corkboard",
      tagline: "Boards and timelines, with free guest access for clients",
      price: "$12 per user / month",
      summary:
        "Corkboard organises work on boards that switch to a list or a timeline view, with a timer on every task. Clients join as free guests, up to 20, and can comment on what is shared with them. Its timeline shows tasks and milestones but does not link tasks that depend on each other.",
      facts: [
        { label: "Price", value: "$12 per user / month billed yearly; $14 billed monthly" },
        { label: "Timelines", value: "Timeline view of tasks and milestones (no task dependencies)" },
        { label: "Client access", value: "Free guest accounts, up to 20, that can view and comment" },
        { label: "Time tracking", value: "Built-in timer on each task" },
        { label: "Reporting", value: "Basic status and time reports" },
        { label: "Storage", value: "100 GB per workspace" },
        { label: "Apps", value: "Web, Mac, Windows, iOS, Android (mobile apps work offline)" },
        { label: "Support", value: "Email and chat, replies within one business day" },
        { label: "Free trial", value: "30 days" },
      ],
      pitch: {
        reviewerTeam: "our 11-person design and architecture studio",
        switchedFrom: "sticky notes on a wall and a calendar nobody kept up to date",
        pain: "The wall told us what everyone was doing today and nothing about next month. Clients asked for updates by phone because there was nowhere else for them to look.",
        highlights: [
          "Corkboard starts as boards, which is how designers already think: a column per stage, a card per task. Switch to the timeline view and the same cards line up by date with their milestones, so the people who live in boards and the people who live in dates are looking at the same work.",
          "Every card has a timer. Press start when you pick up a task, stop when you put it down, and the hours land on the right project for billing. Our weekly timesheets went from a Friday chore to something that is simply already done when Friday comes.",
          "Clients join as free guests, up to twenty of them, and comment on the cards we share. At $12 per person a month for the team, with guests free, it fits the budget with room to spare, and the mobile app works offline on site visits, where basements rarely have signal.",
        ],
        caveat:
          "Corkboard's timeline does not link tasks that depend on each other, so when one task slips we move the next one by hand. With milestones on every project and a short weekly review, that has cost us a few minutes a week, not a single missed deadline.",
        verdict:
          "After six months, Corkboard is where the whole studio works, from the first sketch to the last site visit. It is flexible enough for designers and organised enough for the people who chase dates. It is the one we would choose again.",
        rating: "4.6",
        story: {
          customer: "Brightwater Design Co., a 12-person design and architecture studio in Denver",
          intro: "Brightwater Design Co. is a 12-person design and architecture studio in Denver.",
          speaker: "Marcus Bell, a partner and project lead at the studio",
          firstName: "Marcus",
          before:
            "Its designers planned on whiteboards and its project leads planned in spreadsheets, so the two plans rarely agreed. Hours were reconstructed from memory every Friday, and some were never billed at all.",
          turningPoint:
            "The studio picked Corkboard because the same cards work as a board for the designers and as a timeline for the leads. Every client was invited as a free guest within the first week, and the timers went on the same day.",
          after:
            "Hours are now logged with the timer as the work happens, and invoices go out the day the month ends. Clients comment on shared cards instead of calling, and the site teams update their cards offline from the field.",
          quote: "Half of us think in boards and half of us think in dates. This is the first tool that suits both.",
          quote2: "Free guest accounts meant we could bring every client in without arguing about the bill.",
          closing: "The studio has now run every project through Corkboard for more than a year, from the first sketch to the final site visit.",
        },
        fit: {
          suits: [
            "design-led studios whose people plan in boards and columns",
            "teams that want time logged as they work, with a timer on every task",
            "practices that want clients inside the tool to comment, without paying for their seats",
          ],
          why: [
            "Corkboard's strength is that it does not force one way of planning on a team. The same cards are a board, a list or a timeline with milestones, and each person can work in the view that suits them. The timer on every card means hours are captured where the work happens.",
            "At $12 per person a month billed yearly, with up to twenty client guests free, it also keeps the whole studio and its clients in one place for a predictable price, and its offline mobile apps keep site teams in the loop.",
          ],
          elsewhere: "Teams that need a Gantt chart that reschedules dependent tasks automatically should know that Corkboard's timeline shows milestones but does not link dependencies.",
          bottomLine: "It is the tool we suggest to studios that want everyone, clients included, working in the same place.",
        },
      },
      notes: {
        setup: [
          "Create the workspace and invite the team. Each person can choose the board, list or timeline view as their default, and can switch between them at any time.",
          "Create a board for each project with a column for each stage, or start from one of the included studio templates, which come with stages already named.",
          "Add milestones to each project. They appear on the timeline view alongside the cards' due dates, and can be marked complete from either view.",
          "Show the team where the timer sits on each card. Logged time can be reviewed per project and per person under Reports, and edited if someone forgot to stop it.",
          "Invite clients as guests from a project's Share menu. Guests can view the cards shared with them and comment on them; up to 20 guest accounts are included free.",
        ],
        setupClose: "After these five steps, each project has a board and a timeline, time is being logged against it, and clients can follow and comment on the shared cards.",
        plans: [
          "Corkboard is sold per user, on a single plan. The price is $12 per user per month when billed yearly and $14 per user per month when billed monthly. Up to 20 guest accounts are included at no charge, and additional guests count as users.",
          "Each workspace includes 100 GB of file storage. Apps are available for the web, Mac, Windows, iOS and Android, and the mobile apps work offline and sync when a connection returns. Support is by email and chat, with replies within one business day.",
          "The plan includes the board, list and timeline views, a timer on each task, and basic status and time reports. The timeline shows tasks and milestones; it does not link tasks that depend on each other. New workspaces get a 30-day free trial.",
        ],
        changes: [
          "The timeline view adds zoom levels by week, month and quarter, and remembers the last level used on each project. Milestones stay labelled at every zoom level.",
          "Guests can now be limited to specific cards within a shared project, instead of seeing every card shared on it. Existing guests keep their current access until it is changed.",
          "Time reports can be grouped by client as well as by project and person, and exported to CSV. Grouping by client adds up the hours of every project that client has.",
          "The mobile apps now show which cards edited offline are waiting to sync, and sync them as soon as a connection returns. A card edited on two devices at once keeps both versions for review.",
        ],
      },
    },
    {
      slug: "meridian",
      name: "Meridian",
      tagline: "Linked schedules, built-in time tracking and project dashboards",
      price: "$13 per user / month",
      summary:
        "Meridian pairs Gantt timelines that link dependent tasks and milestones with built-in time tracking and dashboards for budget, status and profitability per project. It has no client access: clients cannot log in or open a shared view of their project.",
      facts: [
        { label: "Price", value: "$13 per user / month billed yearly; $15 billed monthly" },
        { label: "Timelines", value: "Gantt chart with task dependencies and milestones" },
        { label: "Client access", value: "None: no client login and no shared view" },
        { label: "Time tracking", value: "Built in, feeding the project dashboards" },
        { label: "Reporting", value: "Dashboards for budget, profitability and status per project" },
        { label: "Storage", value: "200 GB per workspace" },
        { label: "Apps", value: "Web, Mac, Windows, iOS, Android" },
        { label: "Support", value: "Email and chat on weekdays" },
        { label: "Free trial", value: "21 days" },
      ],
      pitch: {
        reviewerTeam: "our 12-person architecture studio",
        switchedFrom: "spreadsheets for schedules and an accounting export for everything else",
        pain: "We found out which projects made money a month after they closed. Our schedules lived in a file only two people could read, so a slipped date surfaced when a client asked about it.",
        highlights: [
          "Meridian's Gantt chart does what a schedule should: tasks are linked to the tasks they depend on, milestones mark the dates that matter to the client, and when a consultant runs late the whole chain moves with them. We see a slipping deadline weeks out instead of days.",
          "Time tracking is built in and feeds the dashboards directly. Each project shows its budget, its hours, its status and its profitability, and the studio-wide view puts every project on one page. For the first time we knew which kinds of jobs actually paid, while they were still running.",
          "Everything lives in one place for the team: the schedule, the hours and the numbers, with no second app to keep in step. At $13 per person a month, hours included, Meridian sits comfortably inside the budget we had, and it is the first tool our partners open on a Monday.",
        ],
        caveat:
          "Meridian has no client access of any kind: clients cannot log in or open a view of their project. We write each client a short update every Friday from the schedule, which takes a few minutes per project, and several clients told us they prefer an email to one more login.",
        verdict:
          "Six months in, Meridian is how the studio schedules its work, tracks its hours and learns which projects pay. It is the tool we would choose again, and the one we point to for studios that want to run like a business.",
        rating: "4.6",
        story: {
          customer: "Castell Moreno Architects, an 11-person architecture practice in Austin",
          intro: "Castell Moreno Architects is an 11-person architecture practice in Austin.",
          speaker: "Lucia Moreno, the practice's principal",
          firstName: "Lucia",
          before:
            "Its schedules lived in spreadsheets, its hours in a separate timesheet, and its financial picture arrived a month after each project closed. Two projects that looked busy and healthy turned out to have lost money.",
          turningPoint:
            "The practice chose Meridian for its linked Gantt charts and for time tracking that feeds the project dashboards directly. Every live project moved over within two weeks, and the partners started writing a short Friday update to each client from the schedule.",
          after:
            "The partners now review budget and profitability for every live project each week, and fee proposals are based on what similar projects actually cost. Clients receive a written update every Friday, and status calls have mostly stopped. The practice turned down one fixed-fee job it would once have taken at a loss.",
          quote: "I wanted to know whether a project was making money while I could still do something about it.",
          quote2: "A short note in the client's inbox every Friday turned out to be the update they actually read.",
          closing: "The practice has now scheduled, timed and reported every one of its projects in Meridian for more than a year.",
        },
        fit: {
          suits: [
            "studios that want linked Gantt schedules with the milestones their clients care about",
            "practices that bill by the hour and want logged time to feed budget and profitability figures directly",
            "firms that keep client communication in their own hands rather than in a portal",
          ],
          why: [
            "Meridian is built around the schedule and the numbers behind it. Tasks link to the tasks they depend on, milestones anchor the client's key dates, and the built-in time tracker feeds dashboards that show budget, status and profitability per project, so a principal sees both the dates and the money in one place.",
            "At $13 per person a month billed yearly, with time tracking included, it gives a practice a firm's-eye view of its work without an enterprise price tag, and it keeps the team's whole picture of a project in one place.",
          ],
          elsewhere: "Teams whose clients expect to follow their project themselves should know that Meridian has no client access of any kind.",
          bottomLine: "It is the tool we suggest to studios that want their schedule and their numbers to finally agree.",
        },
      },
      notes: {
        setup: [
          "Create the workspace and invite the team. Admin rights can be granted during the invitation or later under Members, and each person sets their working hours.",
          "Create each project with its start and end dates, then add tasks and milestones on the Gantt chart. Milestones can be marked as key dates, which highlights them on the chart.",
          "Link dependent tasks by dragging from one to the next. A linked task moves when the task it depends on moves, and the milestones after it move too.",
          "Set a budget for each project under Dashboard. Hours logged with the built-in time tracker are compared with the budget, and profitability is calculated from them.",
          "Add each client as a contact on their project for the team's reference. Meridian has no client login or shared view, so contacts are used for the team's own notes and reminders.",
        ],
        setupClose: "After these five steps, each project has a linked schedule, a budget and logged hours, and the team sees all three in one place.",
        plans: [
          "Meridian is sold per user, on a single plan. The price is $13 per user per month when billed yearly and $15 per user per month when billed monthly. Time tracking is included in that price.",
          "Each workspace includes 200 GB of file storage. Apps are available for the web, Mac, Windows, iOS and Android. Support is by email and chat on weekdays, with no separate onboarding service. Seats can be added or removed at any time, and billing changes at the next cycle.",
          "The plan includes Gantt charts with dependencies and milestones, built-in time tracking, and dashboards for budget, profitability and status per project. There is no client login and no shared view for clients. New workspaces get a 21-day free trial.",
        ],
        changes: [
          "Client contacts on a project can now carry notes and a reminder date, shown to the team on the project's dashboard. Contacts remain visible to the team only.",
          "Gantt charts can be printed with key dates highlighted and a legend added, for use in the team's own meetings. Printing keeps the page size chosen in the print settings.",
          "The time tracker adds a weekly reminder to anyone with a missing day on their timesheet. Reminders can be turned off per person, and they skip days marked as leave.",
          "Dashboards can now compare a project's hours with the hours of earlier projects of the same type, using the project type set when the project was created. Projects created before this update can be given a type from their settings page.",
        ],
      },
    },
  ],
};
