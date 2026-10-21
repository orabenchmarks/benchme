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
  forum: {
    title: "Which project management tool for a 12-person architecture practice?",
    question:
      "There are a dozen of us in a small architecture practice, with nine or ten client projects running at once. Our deadlines are chained together (structural engineers, planning approvals, client sign-offs), and when one slips nobody sees what else has to move, because it all lives in spreadsheets and inboxes. Most of our clients pay by the hour, so we need to track time, and we want shared timelines for every project plus some way for clients to check where theirs stands. The office is a mix of Macs and Windows machines, and we'd like to spend roughly ten to fifteen dollars per person a month, so what would you choose?",
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
      voices: {
        newsletter: {
          hook: "It gets a whole office planning from the same timelines within days, and it shows the knock-on of every slipped date as it happens. Four readers from practices under fifteen people wrote in about it this month.",
          reasons: [
            "Tasklane puts a Gantt chart on top of each project's task list, and you link two tasks by dragging from one to the other. Push back a structural engineer's due date and everything waiting on it shifts, finish date included. A marker for today stays on screen as you scroll across the months.",
            "Every project can have its own share link for the client, and it opens without an account. The view is read-only, so a client can check every date but cannot move one. Any link can be revoked or regenerated at any time, so a finished project's link is simply switched off.",
            "It costs $9 a seat billed yearly, on a single plan with no upgrade to chase later. Seats can be added for a summer intern and dropped when they leave, with the bill following at the next cycle. Every workspace gets 100 GB of storage, shared across its projects.",
          ],
          signoff: "The free trial runs 30 days, long enough to put two live projects through it.",
        },
        forum: {
          replies: [
            {
              handle: "linden_arch",
              text: "We're nine people doing mostly residential extensions, and our dates hang off each other just like yours. Tasklane was what finally made the knock-on visible: when the council pushed a committee date back three weeks, the four tasks behind it moved on their own. Nobody had to rebuild the plan by hand. Set the overdue alerts to arrive a week ahead and you see trouble coming.",
            },
            {
              handle: "MPereira",
              text: "One thing to know: Tasklane has no time tracking, and you said you bill by the hour. So do we, and our hours go into the timesheet in our accounting package, which we'd keep for invoicing anyway. It's the one thing on your list it doesn't do, and it costs each of us about a minute a day. In two years it hasn't caused a single billing mistake.",
            },
            {
              handle: "halle_studio",
              text: "The share link covers your client question. We send it the day a project starts, and a couple of clients now open it before every site meeting, so we all arrive with the same dates. Half our office is on Macs and half on Windows, Tasklane behaves the same on both, and it comes in under your budget. I'd trial it on your two messiest projects.",
            },
          ],
        },
        column: {
          author: "Ines Calloway, an operations consultant who has moved more than thirty design practices off spreadsheets",
          opening:
            "Most studios I visit do not need more software; they need one place where the dates are true. When a practice of ten or twelve asks me where to start, I usually point them to Tasklane. When I check in on those teams a year later, they are still planning in it every day.",
          argument: [
            "A project lead can learn it in an hour, and a whole office in a week. Dependencies are drawn by dragging between tasks, so when a consultant slips, the late finish is on the chart at once rather than at the next meeting. Clients each get a view of their project that they can read but not change, so nobody waits for a status report.",
            "There is no time tracking in Tasklane, and for a studio that bills by the hour that is always the first question. My answer is that most practices already keep hours in their accounting or payroll software, where the invoices are made. Keeping the plan and the timesheet in separate places has cost the studios I advise a few minutes a week, not a missed invoice.",
          ],
          verdict:
            "If deadlines that nobody sees moving are your problem, Tasklane is where I would start a studio of your size. Load the three busiest projects first, and the rest of the office tends to follow within a fortnight.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the habit. Twelve months on, all eleven of our live projects still have a current timeline in Tasklane, and nobody keeps a private spreadsheet on the side, which was the real test. The linked dates caught three consultant delays early enough for us to reorder the work around them.",
            "Some of it got better through updates. Share links can now carry a password, which two of our institutional clients required, and the import reads day-first dates, which mattered when we took on a schedule from a partner firm in Lisbon. The today marker sounds trivial, but it is the feature new starters mention first.",
            "A buyer should know that it rewards a little discipline at the start. Draw the dependencies properly in the first week, give every task an owner, and decide how many days ahead a deadline should count as close before the alerts begin. Do that and it more or less runs itself for the rest of the year.",
          ],
        },
        diary: {
          author: "Joanna, studio manager at an eight-person architecture practice",
          entries: [
            "Imported our project list into Tasklane this morning. Our dates are written day-first, and it asked which order we meant for the ambiguous ones before saving anything, which saved me an evening. Seven projects are in, with dependencies to draw tomorrow.",
            "Every project has its links drawn now. On Thursday I moved one engineer's deadline as a test and watched the planning submission and two client reviews slide with it. The partners went quiet for a moment, then asked me to switch on the alerts.",
            "Sent read-only links to all seven clients this week. One asked whether he could change a date himself, and I could tell him honestly that the link won't let anyone do that. Calls asking where things stand are down to one or two a week.",
            "Tasklane is simply how we work now. Our two interns learned it on their own in an afternoon, and nobody has asked for the spreadsheet back. Last week it showed us a survey clashing with a planning deadline five weeks before it would have hit.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "It keeps the schedule, the hours and the client's sign-offs in one set of projects, and it shows who is free next week too. Four readers from practices that bill by the hour wrote in about it this month.",
          reasons: [
            "Plotwise links dependent tasks on a Gantt chart and puts a workload view beside it, one row per person. A slipped date and an overbooked architect show up on the same morning instead of a week apart. The workload view now looks four weeks ahead and subtracts anyone's leave.",
            "Everyone logs hours against the task in hand, and each project carries an hour budget that can be split by stage. When a stage passes 80 percent of its hours, the project lead gets a warning. It arrives while there is still time to talk to the client.",
            "Clients get a portal where they comment on drawings and approve a stage, and portal seats are free. Each client sees only the milestones and files you pick for them. An email digest of new comments and pending approvals, daily or weekly, keeps slower approvers moving.",
          ],
          signoff: "Book the onboarding call inside the 14-day trial and set it up on real projects.",
        },
        forum: {
          replies: [
            {
              handle: "kestrel_works",
              text: "We're thirteen people, mostly school and healthcare work, and our consultants' dates chain together the same way. In Plotwise a late task drags the tasks tied to it along, and the per-person workload view tells you whether whoever inherits the delay actually has the hours. That second part is what ended our late nights. Last month it flagged an engineer's delay that would have landed on someone already fully booked.",
            },
            {
              handle: "BeaMakes",
              text: "Honest caveat: Plotwise costs more per person than the ten to fifteen dollars you mentioned, and that's the one thing on your list it misses. It was over our budget too. What settled it was the time tracking: we see a stage running over while it's still happening, and one extra billed hour per person a month covers the difference. In two years it has paid its way every quarter.",
            },
            {
              handle: "ola_draws",
              text: "For clients, the portal is the answer: ours approve stages there, and their comments sit on the drawing they're about instead of in a reply-all chain. We run Plotwise on Macs in the studio and Windows laptops on site, and it's the same on both. Hours and dates live in the same projects, so nobody reconciles two systems any more. I'd start with the two projects whose hours worry you most.",
            },
          ],
        },
        column: {
          author: "Tomas Lindqvist, who has set up project and time systems for more than thirty architecture firms",
          opening:
            "The studios that call me usually have three problems at once: deadlines that slip quietly, hours that overrun unseen and approvals lost in email. Plotwise is what I recommend to most of them, because it puts all three in front of the same people. Of the eleven practices where I have set it up, every one still runs its projects through it.",
          argument: [
            "Its timeline links dependent tasks, and the workload view reveals who will absorb a slipped date before anyone promises it to a client. Hours are logged against tasks and counted against each stage's budget, with a warning at a threshold you choose per project. The client portal turns an approval into a single button rather than a long email thread.",
            "Plotwise is not cheap: at $17 a seat billed yearly, it sits above the budget most small studios start with. I ask clients to weigh it against the hours they currently fail to bill, not against the subscription line on their accounts. Among my own clients, the hours it recovered paid for the seats within the first quarter.",
          ],
          verdict:
            "For a studio of eight to twenty that bills by the hour, Plotwise is my recommendation. Take the onboarding call, give the setup the fortnight it needs, and bring clients into the portal once the milestones are in place.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the weekly look at hours. A year in, our project leads still open Plotwise on the hours-against-budget report every Thursday, and we have not found out about an overrun after the fact since the first month. The workload view ended most of our arguments about who could take on what.",
            "It also got better. Timesheets now export to CSV by project, task, person and date, which our bookkeeper imports in one go each month, and the workload view can be filtered by team now that we have an interiors group. Our slowest client approver now signs off within three days.",
            "A buyer should know that the first fortnight is real work. Spend the onboarding call on stage budgets and client roles, draw the dependencies before you lean on the workload view, and give people a week of logging before you trust the numbers. After that it asks very little of anyone.",
          ],
        },
        diary: {
          author: "Felix, practice manager at a 15-person architecture firm",
          entries: [
            "Started the Plotwise trial and booked the onboarding call for Thursday. Set up roles first: partners as admins, everyone else as members, clients to come later. Each role gets its own home page, which the partners liked.",
            "The onboarding call took about an hour and used our own projects, and we came out of it with hour budgets on every live job. Twelve projects are imported from CSV. Dependencies are drawn on half of them, the rest next week.",
            "Everyone logs time against tasks now, and the workload view stopped me handing a fifth project to someone already carrying four. Clients went into the portal this week. One approved a stage the same afternoon we posted it.",
            "Plotwise warned us when a stage crossed 80 percent with half the drawings still to do, and we talked to the client before the overrun instead of after it. Both partners now check their projects' hours before their first coffee. Nobody wants the old whiteboard back.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "It starts from boards and cards, the way most designers already lay out a week, and adds a timer to each task and free seats for clients. Four readers from design-led practices wrote in about it this month.",
          reasons: [
            "Corkboard lets each person open a project as columns of cards, a plain list or a timeline, and keep whichever they like as their default. On the timeline, tasks and milestones sit by date, and it zooms from a week to a whole quarter. Studio templates come with the stages already named.",
            "Every task has a timer, so hours are caught while the work happens instead of being estimated afterwards. Anyone who forgets to stop it can correct the entry later. Reports show the hours per project and per person from the first day, with nothing extra to set up.",
            "Clients join as guests who can view and comment on what you share, and up to 20 of them are free. Guests can now be limited to particular cards, so a client sees their own drawings and none of your internal notes. The team pays $12 a seat on the yearly plan.",
          ],
          signoff: "Use the 30-day trial to take one full design stage through it, clients included.",
        },
        forum: {
          replies: [
            {
              handle: "studio_wren",
              text: "We're ten, architects and interior designers, and our designers think in sketches and pin-ups, not charts. Corkboard got them in because it opens as a board, while the project leads switch the same cards to the timeline. The timer on each card means our hours are complete for the first time. The unbilled time we used to guess at, about a day a week, is basically gone.",
            },
            {
              handle: "fitout_fern",
              text: "The catch, given what you wrote: Corkboard's timeline doesn't link dependent tasks, so when a consultant slips you move the follow-on dates yourself. That's the one thing on your list it misses, and it worried us too. In practice each of our projects has five or six hard dependencies, and our leads check them whenever a milestone moves. In two years we haven't missed a date because of it.",
            },
            {
              handle: "OliverDraws",
              text: "For clients, the free guest seats are why I'd pick it: up to twenty clients can comment on the cards you share without adding to the bill. Our office is on Macs, our two site architects carry Windows laptops, and Corkboard works the same on both. It also fits inside your budget with room left over. I'd invite one client as a guest during the trial and ask what they think.",
            },
          ],
        },
        column: {
          author: "Ruth Adeyemi, who has set up project tools for more than thirty design studios",
          opening:
            "The tool a studio picks matters less than whether its designers are still using it after the first month. That is why I put Corkboard in front of most design-led practices I advise: it meets people where they already plan, on cards and in columns. A year on, those studios still have every designer working in it.",
          argument: [
            "No one has to change habits: a designer can keep a project on a board while the lead reads it as a timeline with milestones. Each card also carries its own timer, and time reports can be grouped by client, which is the view a studio invoices from. As many as twenty clients can come in at no charge and leave comments beside the work.",
            "The honest limit: Corkboard does not tie one task's dates to another's, so later tasks stay put when an earlier one slips. Most projects I see have only a handful of linked dates, which the lead lists on the first card and rechecks whenever a consultant reports a delay. Moving a few cards by hand takes minutes, and none of my clients has missed a date over it.",
          ],
          verdict:
            "For a design-led studio of up to twenty people, Corkboard is the one I recommend. Bring the clients in during the trial rather than after it, and start the timers on the first morning.",
        },
        longterm: {
          paragraphs: [
            "What lasted is that everyone still works in the view they chose. Twelve months on, our designers are on boards and our two project leads are on the timeline, all of them looking at the same cards in Corkboard. The timers stayed on, which was the part we doubted most.",
            "The mobile apps got better: they now show which cards edited offline are still waiting to sync, and a card changed on two phones at once keeps both versions for review instead of losing one. Time reports now export to CSV as well. Our bookkeeper noticed that before anyone else did.",
            "A buyer should know that it works best when every project has its milestones set from the first day. Name the stages in the template before you import anything, and let each person choose their default view in the first week. Invite clients early, so their comments start in the tool rather than in email.",
          ],
        },
        diary: {
          author: "Imogen, office manager at a nine-person interiors and architecture studio",
          entries: [
            "Set up Corkboard from the studio template, which already had our stages named, so the boards looked familiar by lunch. Everyone picked a default view. Most designers chose the board and both project leads chose the timeline.",
            "Timers went on Monday. By Friday the hours report held more than our old timesheets ever did, and two people found they had been leaving site visits off altogether. Nobody complained about pressing the button, which surprised me.",
            "Invited our first six clients as guests and shared only their own cards with them. One left eleven comments on a lighting layout in a single evening, all in one place. Email threads about drawings have mostly stopped.",
            "The whole studio runs on Corkboard now. Month-end invoicing takes an afternoon instead of two days, because the hours are already there. The site team updates cards on their phones during visits, and the changes sync on the drive back.",
          ],
        },
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
      voices: {
        newsletter: {
          hook: "It ties a project's schedule to the hours spent on it, so a late consultant and a job running over budget show up in the same place. Four readers who run small practices wrote in about it this month.",
          reasons: [
            "Meridian links each task to the ones it depends on, and when a task runs late, the milestones after it move too. Key dates can be flagged so they stand out on the chart. Charts now print with those dates highlighted and a legend, which is handy for the team's own meetings.",
            "Hours logged in the built-in tracker feed straight into each project's dashboard, beside its budget and profitability. A new comparison sets this job's hours against earlier jobs of the same type. Halfway through a house extension, you can see whether it is running like your last three.",
            "It costs $13 a seat billed yearly, and that price includes the time tracking. Seats can be added or removed whenever the team changes, with billing following at the next cycle. Each workspace also comes with 200 GB of storage for drawings, photographs and reports.",
          ],
          signoff: "Run three weeks of real hours through the 21-day trial, then read the dashboards.",
        },
        forum: {
          replies: [
            {
              handle: "gable_and_co",
              text: "We're a twelve-person practice doing mostly commercial fit-outs, with consultant dates stacked exactly as you describe. Meridian links them, so when our fire engineer came in two weeks late in March, the milestones behind him moved and we saw the clash with the contractor's start date that afternoon. We reordered the work before anyone was left waiting. Mark the dates your clients care about as key dates from the start.",
            },
            {
              handle: "RHalvorsen",
              text: "To be straight with you, Meridian has no client access at all: clients can't log in, and there's no view you can share with them. That's the one thing on your list it misses. We handle it by phone: each client contact on a project carries a reminder date, and the project architect rings them when it comes up. In two years no client has asked us for a login.",
            },
            {
              handle: "practice_ledger",
              text: "For the hourly side, the time tracking is the reason to pick it: hours feed each project's dashboard, so a job drifting over budget shows up in week three, not at the final invoice. We've got Macs in the studio and Windows machines upstairs in accounts, and Meridian runs the same on both. It also sits inside your budget with time tracking included. I'd load your hourly jobs first during the trial.",
            },
          ],
        },
        column: {
          author: "Daniel Ferreira, a practice consultant who has set up scheduling and time systems for more than thirty small firms",
          opening:
            "When a practice tells me its deadlines keep slipping and it cannot say which jobs pay, I start with the schedule and the hours together. More often than not, that means Meridian, which treats the programme and the money as one subject, the way principals already think. Every firm I have put on it still reviews its dashboards weekly.",
          argument: [
            "Its Gantt charts link dependent tasks and carry the milestones that matter, so a consultant's delay arrives as a moved key date rather than a surprise. Time is logged inside the tool and lands on each project's dashboard next to its budget and margin. A slipped date and an overspent budget turn up in the same weekly review, so the hard conversation happens once.",
            "The gap is client access: Meridian has none, so there is no login, portal or link a client can use to follow their project. I tell principals to decide early how clients will hear about progress, and most settle on a short call or a note at each milestone. In the practices I work with, clients have rarely asked for more than that.",
          ],
          verdict:
            "If your schedule and your numbers live in different files today, Meridian is the tool I would put in. Link the consultants' tasks in the first week, and set every project's budget before the first hour is logged.",
        },
        longterm: {
          paragraphs: [
            "What lasted is the weekly read of the numbers. Twelve months on, our partners still go through every project's dashboard in Meridian before anything else, and the linked charts have flagged each late consultant before the knock-on reached site. Our timesheets are complete, which is new for us.",
            "The updates helped. The timesheet reminder now nudges anyone with a missing day and leaves people on leave alone, so nobody chases hours by hand any more. Older projects can now be given a type from their settings, so our first year's work feeds the comparisons too.",
            "A buyer should know that the dashboards are only as good as the budgets behind them. Set a budget on every project before work starts, give each project a type so the comparisons mean something, and have everyone enter their working hours in the first week. The rest follows from there.",
          ],
        },
        diary: {
          author: "Rafael, operations lead at a 12-person architecture studio",
          entries: [
            "Started the Meridian trial and had everyone set their working hours before anything else. Built our two biggest projects on the Gantt chart, with their key dates flagged. It already looks more honest than the spreadsheet did.",
            "All nine live projects are in, with every consultant task linked to whatever depends on it. I nudged a survey date as a test and watched the planning submission and the client's key date move with it. Budgets go in on Monday.",
            "Everyone is logging time now, and the weekly reminder caught the two people who always forget Fridays. The first dashboards show one project comfortably ahead and one already over. We would not have known about the second until the invoice.",
            "Meridian is where the partners run the practice from now. We priced a new extension using the comparison with earlier jobs, and the fee came closer to the real hours than any we've quoted before. The schedule hasn't caught us out once.",
          ],
        },
      },
    },
  ],
};
