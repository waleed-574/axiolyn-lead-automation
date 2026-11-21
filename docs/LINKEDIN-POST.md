# LinkedIn post — draft

Plain text on purpose: LinkedIn does not render Markdown. Numbers are real as
of 2026-11-13; rerun `npm run stats` and `npm run stats:intl` before posting if
time has passed. LinkedIn's limit is 3,000 characters.

Images, in order: linkedin-1-workflow-square.png, linkedin-2-pakistan-leads.png,
linkedin-3-us-uk-leads.png (on the Desktop).

---

A friend of mine runs Axiolyn, a small automation agency, and a couple of months ago he told me how they were finding clients. Googling businesses, opening their websites one by one, copying emails into a spreadsheet. For a team that sells automation, that was a bit embarrassing.

So I offered to build him something better. The brief was simple: find leads in Pakistan and abroad, on a budget of zero. No paid tools, no Apollo, no server to rent.

It has been running on its own for a while now, and it has found 15,506 businesses so far. 4,208 in Pakistan, 5,356 in the US and 5,942 in the UK, with 2,876 verified email addresses between them.

Here is roughly how it works. Several times a day it pulls businesses from OpenStreetMap, city by city and category by category. It visits each company's website and looks for contact details, checks that the email domain can actually receive mail, and then gives every lead a score out of 100 with a short reason behind it. Everything lands in a Google Sheet with the best leads at the top. It's built with n8n and Node.js, and runs for free on GitHub Actions.

The scoring is the part I enjoyed most. I figured the best client for an automation agency is a business that is clearly busy but has no automation at all. So the system looks at each website and notices what's missing, like a CRM, a chat widget or online booking. A clinic with a busy website and no way to book online is still taking appointments over the phone, and that gives the team something real to talk to them about.

A few things I learned by running it on real data:

One of the data servers kept replying "OK" with zero results, because it only holds data for Switzerland. Nothing crashed, nothing was saved, and for a while I had no idea. A quiet failure is much harder to catch than a loud one.

How you ask matters more than where you ask. My first search found websites for about 3% of businesses. After changing the shape of the query, it was 82%.

Central London is so dense that the map server refused my query every single time, until I split the area into smaller pieces.

If you have a process like this that eats up your team's week, I'd be happy to hear about it. Send me a message.

You can check out my friend's agency at https://axiolyn.com

#automation #n8n #leadgeneration #pakistan
