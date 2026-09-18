# The audit fixes, as a customer would meet them (2026-09-18)

Thirty-two multi-turn conversations run through the real engine, the real workbook and the library as
listed on 2026-09-18 (`tests/_current-library.ts`), WhatsApp unless marked. Nothing here was sent to
anyone: it is the simulator. "ONE alert" lines show the urgency, the tags (most important first), the
cars, and a requested time when there is one.

```text
1. Ordinary words, then a real car
   Customer: It's my dream car
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [normal] NEEDS_PERSON
   Customer: the Dream price?
     Bot: Here is the VOYAH Dream brochure.
     Bot: [brochure Voyah-dream.pdf]
     Bot: Here is a video of the VOYAH Dream.
     Bot: [video Midnight-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · DREAM

2. Weak match is asked
   Customer: dream is nice
     Bot: Did you mean the VOYAH Dream?  {VOYAH Dream}
   Customer: yes
     Bot: Here is the VOYAH Dream brochure.
     Bot: [brochure Voyah-dream.pdf]
     Bot: Here is a video of the VOYAH Dream.
     Bot: [video Midnight-Black.mp4]
     → ONE alert to Sales [qualified] LEAD · DREAM

3. Same question, another car
   Customer: Courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: price
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · COURAGE
   Customer: and the Taishan?
     Bot: Here is the VOYAH Taishan brochure.
     Bot: [brochure Taishan.pdf]
     Bot: Here is the VOYAH Taishan in Obsidian Black.
     Bot: [video c.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · TAISHAN

4. Comparison from context
   Customer: Courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: Dream
     Bot: Here is the VOYAH Dream brochure.
     Bot: [brochure Voyah-dream.pdf]
     Bot: Here is a video of the VOYAH Dream.
     Bot: [video Midnight-Black.mp4]
     → ONE alert to Sales [qualified] LEAD · DREAM
   Customer: which has more range?
     Bot: Here is a side-by-side comparison of the VOYAH Dream and VOYAH Courage: / VOYAH Dream / • Range: 185 km EV / 915 km combined (WLTP) / VOYAH Courage / • Range: 550 km of WLTP range on a full charge, and 440 km i…

5. Test drive: day, then time
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: I want a test drive
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: We'd be happy to arrange a test drive of the VOYAH Courage. Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] TEST_DRIVE · COURAGE
   Customer: tomorrow
     Bot: Noted, Fri 18 Sep. What time would suit you?
     → ONE alert to Sales [qualified] TEST_DRIVE · COURAGE
   Customer: at 4
     Bot: Thank you. I've passed Fri 18 Sep, 16:00 to our Sales Team as your preferred time, and a team member will confirm it with you right here.
     → ONE alert to Sales [qualified] TEST_DRIVE · COURAGE · 2026-09-18T13:00:00.000Z

6. Test drive on a Sunday
   Customer: taishan
     Bot: Here is the VOYAH Taishan brochure.
     Bot: [brochure Taishan.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Taishan in Obsidian Black, Sapphire Blue or Storm Grey.  {Obsidian Black | Sapphire Blue | Storm Grey}
   Customer: test drive on sunday
     Bot: We'd be happy to arrange a test drive of the VOYAH Taishan. Our Sales Team will assist you further right here with all the details you need.
     Bot: We're closed on Sundays. We're open Monday to Friday from 8:00 AM to 6:00 PM and Saturday from 8:00 AM to 2:00 PM. Which other day would suit you?
     → ONE alert to Sales [qualified] TEST_DRIVE · TAISHAN
   Customer: monday at 11 then
     Bot: Thank you. I've passed Mon 21 Sep, 11:00 to our Sales Team as your preferred time, and a team member will confirm it with you right here.
     → ONE alert to Sales [qualified] TEST_DRIVE · TAISHAN · 2026-09-21T08:00:00.000Z

7. Two cars and a colour
   Customer: courage and dream
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Here is the VOYAH Dream brochure.
     Bot: [brochure Voyah-dream.pdf]
     Bot: VOYAH Courage / • Power: 430 HP / • Range: 550 km of WLTP range on a full charge, and 440 km if uphill / • Powertrain: BEV / Fully Electric / VOYAH Dream / • Power: 416 hp / • Range: 185 km EV / 915 km combined…
     Bot: Which one are you interested in?  {VOYAH Courage | VOYAH Dream}
   Customer: black
     Bot: Which car would you like to see in black?  {VOYAH Courage | VOYAH Dream}
   Customer: VOYAH Courage
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     → ONE alert to Sales [qualified] LEAD · COURAGE

8. Trade-in with photo and valuation
   Customer: can I sell you my car?
     Bot: Yes, we do accept trade-ins. / We can evaluate your current vehicle and apply its value toward the purchase of your new car. / To start the valuation, please send us: / • Car make and model / • Year / • Mileage…
   Customer: bmw x5 2019 80000 km
     Bot: Thank you. Our team will review your vehicle details and contact you about the valuation.
     → ONE alert to Sales [qualified] TRADE_IN
   Customer: [a photo]
     Bot: Thank you, we've received your photos. Our team will review them with your vehicle details and get back to you about the valuation right here.
     → ONE alert to Sales [qualified] TRADE_IN
   Customer: how much will you give me?
     Bot: The valuation is done by our team once they have reviewed your vehicle. They will get back to you with it right here.
     → ONE alert to Sales [qualified] TRADE_IN

9. Same car twice
   Customer: Courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: Courage
     Bot: VOYAH Courage: / • Power: 430 HP / • Range: 550 km of WLTP range on a full charge, and 440 km if uphill / • Powertrain: BEV / Fully Electric
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}

10. No video
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: No video please
     Bot: Noted. I won't send you the video.
   Customer: price
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · COURAGE

11. No brochure
   Customer: I don't want the brochure
     Bot: Noted. I won't send you the brochure.
   Customer: taishan
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Taishan in Obsidian Black, Sapphire Blue or Storm Grey.  {Obsidian Black | Sapphire Blue | Storm Grey}
   Customer: range?
     Bot: The VOYAH Taishan offers 410 km EV / 1,400 km combined (CLTC).

12. Buying intent
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: Pearl Black
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     → ONE alert to Sales [qualified] LEAD · COURAGE
   Customer: I'll take it
     Bot: Wonderful. I've let our Sales Team know that you'd like to go ahead with the VOYAH Courage, and a team member will take you through the next steps right here.
     → ONE alert to Sales [hot] BUYING · COURAGE

13. Buying intent, no car
   Customer: reserve one for me
     Bot: Which model are you interested in?  {VOYAH Free 318 | VOYAH Courage | VOYAH Dream | VOYAH Passion | VOYAH Passion L | VOYAH Taishan | MHERO 1 | MHERO 2}
     → ONE alert to Sales [hot] BUYING
   Customer: VOYAH Taishan
     Bot: Here is the VOYAH Taishan brochure.
     Bot: [brochure Taishan.pdf]
     Bot: Here is the VOYAH Taishan in Obsidian Black.
     Bot: [video c.mp4]
     Bot: Wonderful. I've let our Sales Team know that you'd like to go ahead with the VOYAH Taishan, and a team member will take you through the next steps right here.
     → ONE alert to Sales [hot] BUYING · TAISHAN

14. One consolidated alert
   Customer: I want the Courage, do you have stock, can I finance it and test drive tomorrow?
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Our Sales Team will confirm the current availability of the VOYAH Courage with you right here.
     Bot: Yes, we offer installment and payment facilities, with options depending on the model and payment plan.
     Bot: Our Sales Team will assist you further right here with all the details you need.
     Bot: We'd be happy to arrange a test drive of the VOYAH Courage.
     Bot: Noted, Fri 18 Sep. What time would suit you?
     → ONE alert to Sales [qualified] BUYING + TEST_DRIVE + FINANCING + STOCK · COURAGE
   Customer: at 11
     Bot: Thank you. I've passed Fri 18 Sep, 11:00 to our Sales Team as your preferred time, and a team member will confirm it with you right here.
     → ONE alert to Sales [qualified] TEST_DRIVE · COURAGE · 2026-09-18T08:00:00.000Z

15. Ad context, then a switch
   Customer: how much is it?  [came from the ad "Voyah COURAGE"]
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · COURAGE
   Customer: Actually I'm interested in the Dream
     Bot: Here is the VOYAH Dream brochure.
     Bot: [brochure Voyah-dream.pdf]
     Bot: Here is a video of the VOYAH Dream.
     Bot: [video Midnight-Black.mp4]
     → ONE alert to Sales [qualified] LEAD · DREAM
   Customer: how much is it?
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · DREAM

16. Battery questions
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: Is the battery safe?
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [normal] NEEDS_PERSON · COURAGE
   Customer: battery life, how many years?
     Bot: The VOYAH Courage comes with a warranty of 6 years on the vehicle and 10 years on the battery.
     Bot: The battery's expected lifespan beyond the warranty is not in our approved information yet. Our Sales Team can confirm it with you right here.
     → ONE alert to Sales [normal] QUESTION · COURAGE
   Customer: battery replacement cost
     Bot: For Service, Maintenance, Spare Parts, After-Sales, or a vehicle problem, please contact us on WhatsApp at 76 877 278.
     → flagged for staff: An owner needs after-sales (a battery replacement) — given the Service number, never sales material.

17. Charging questions
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: do you give a charger?
     Bot: I don't have approved information about the charger supplied with the car for the VOYAH Courage to share here. Our Sales Team can confirm it with you right here.
     → ONE alert to Sales [normal] QUESTION · COURAGE
   Customer: can I charge at home?
     Bot: I don't have approved information about home charging for the VOYAH Courage to share here. Our Sales Team can confirm it with you right here.
     → ONE alert to Sales [normal] QUESTION · COURAGE
   Customer: Where can I charge in Lebanon?
     Bot: I don't have approved information about public charging in Lebanon for the VOYAH Courage to share here. Our Sales Team can confirm it with you right here.
     → ONE alert to Sales [normal] QUESTION · COURAGE
   Customer: How much does charging cost?
     Bot: I don't have approved information about charging costs for the VOYAH Courage to share here. Our Sales Team can confirm it with you right here.
     → ONE alert to Sales [normal] QUESTION · COURAGE
   Customer: how long to charge
     Bot: For the VOYAH Courage, the approved charging information is: 0% - 100% 6H 32 AMP AC 0% - 100% 25 Min DC.

18. Garage and origin
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: Will it fit in my garage?
     Bot: The VOYAH Courage measures 4,725 × 1,900 × 1,650 mm · 527 L / 1,400 L folded.
   Customer: Where is Voyah from?
     Bot: I don't have approved information about where the brand comes from and who makes it to share here. Our Sales Team can confirm it with you right here.
     → ONE alert to Sales [normal] QUESTION

19. Owner with a problem
   Customer: I own a Voyah Free and the screen is frozen
     Bot: For Service, Maintenance, Spare Parts, After-Sales, or a vehicle problem, please contact us on WhatsApp at 76 877 278.
     → flagged for staff: An owner needs after-sales (a problem with their car) — given the Service number, never sales material.
   Customer: ok thanks
     Bot: (says nothing — An acknowledgement — nothing new was asked.)

20. Warranty claim / spare key
   Customer: My warranty claim
     Bot: For Service, Maintenance, Spare Parts, After-Sales, or a vehicle problem, please contact us on WhatsApp at 76 877 278.
     → flagged for staff: An owner needs after-sales (a warranty claim) — given the Service number, never sales material.
   Customer: i also need a spare key
     Bot: For Service, Maintenance, Spare Parts, After-Sales, or a vehicle problem, please contact us on WhatsApp at 76 877 278.
     → flagged for staff: An owner needs after-sales (a problem with their car) — given the Service number, never sales material.

21. Phone number on Instagram (instagram)
   Customer: call me
     Bot: Certainly. Which phone number should our sales team call you on?
   Customer: 71 222 333
     Bot: Certainly. Our sales team will call you on +96171222333 shortly.
     → ONE alert to Sales [qualified] CALLBACK · +96171222333

22. Wrong number / not interested
   Customer: courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: Not interested
     Bot: No problem at all. Thank you for your time, and if you ever need anything, we're right here.
   Customer: ok
     Bot: (says nothing — An acknowledgement — nothing new was asked.)

23. Financing words
   Customer: can I pay over 5 years?
     Bot: Yes, we offer installment and payment facilities, with options depending on the model and payment plan.
     Bot: Which model are you interested in?  {VOYAH Free 318 | VOYAH Courage | VOYAH Dream | VOYAH Passion | VOYAH Passion L | VOYAH Taishan | MHERO 1 | MHERO 2}
     → ONE alert to Sales [qualified] FINANCING
   Customer: VOYAH Courage
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] FINANCING · COURAGE

24. Visit on a closed day
   Customer: can I pass by tomorrow?
     Bot: We're closed on Sundays. We're open Monday to Friday from 8:00 AM to 6:00 PM and Saturday from 8:00 AM to 2:00 PM. Which other day would suit you?
     → ONE alert to Sales [qualified] VISIT
   Customer: monday then, at 10
     Bot: You're most welcome to visit us. I've let our Sales Team know to expect you on Mon 21 Sep, 10:00. / Our showroom is located in Horch Tabet, Beirut. / https://maps.app.goo.gl/CVPJQqXfnnbBmubZ8 / Our showroom is …
     → ONE alert to Sales [qualified] VISIT · 2026-09-21T07:00:00.000Z

25. Recommendation
   Customer: I need a family car
     Bot: Seats: / • VOYAH Dream — 7 / • VOYAH Taishan — 6 to 7 seats
     Bot: Which model would you like to explore further?  {VOYAH Dream | VOYAH Taishan}
   Customer: VOYAH Dream
     Bot: Here is the VOYAH Dream brochure.
     Bot: [brochure Voyah-dream.pdf]
     Bot: Here is a video of the VOYAH Dream.
     Bot: [video Midnight-Black.mp4]
     → ONE alert to Sales [qualified] LEAD · DREAM
   Customer: how many seats
     Bot: The VOYAH Dream has 7 seats.

26. Budget
   Customer: my budget is 40k what do you recommend
     Bot: Our Sales Team can recommend the right model for your budget and will assist you right here. In the meantime, here is our current range.
     Bot: Which model are you interested in?  {VOYAH Free 318 | VOYAH Courage | VOYAH Dream | VOYAH Passion | VOYAH Passion L | VOYAH Taishan | MHERO 1 | MHERO 2}
     → ONE alert to Sales [qualified] PRICE

27. Kept waiting
   Customer: courage price
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · COURAGE
   Customer: I've been waiting since yesterday
     Bot: We're sorry to have kept you waiting. I've flagged your conversation to our Sales Team as a priority, and a team member will reply to you right here.
     → ONE alert to Sales [overdue] OVERDUE · COURAGE

28. Greetings and nudges
   Customer: anyone?
     Bot: Hello and welcome to Monza S.A.L. How can we help you today? / Please choose an option:  {Sales | Customer Service | After-Sales | Service & Maintenance | Administration}
   Customer: Sales
     Bot: Which model are you interested in?  {VOYAH Free 318 | VOYAH Courage | VOYAH Dream | VOYAH Passion | VOYAH Passion L | VOYAH Taishan | MHERO 1 | MHERO 2}
   Customer: VOYAH Free 318
     Bot: Here is the VOYAH Free 318 brochure.
     Bot: [brochure Voyah-free.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Free 318 in British Racing Green, Midnight Black, Pearl White, Sage Green or Titanium Grey.  {British Racing Green | Midnight Black | Pearl White | Sage Green | Titanium Grey}
   Customer: ?
     Bot: We're here. How can we help you?

29. Arabizi
   Customer: 3andkon siyarat kahraba?
     Bot: For fully electric driving, we currently offer the VOYAH Courage. / Would you like to see it?  {VOYAH Courage}
   Customer: yes
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Courage in Crayon Grey, Pearl Black or Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: adde se3era
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · COURAGE

30. Arabic
   Customer: مرحبا
     Bot: أهلاً وسهلاً بكم في Monza S.A.L. كيف يمكننا مساعدتكم اليوم؟ / يرجى اختيار قسم:  {المبيعات | خدمة العملاء | ما بعد البيع | الصيانة | الإدارة}
   Customer: شو الالوان المتوفرة للكوراج
     Bot: إليكم كتالوج VOYAH Courage.
     Bot: [brochure Voyah-courage.pdf]
     Bot: أي لون خارجي تودون رؤيته؟ يمكننا عرض VOYAH Courage باللون Crayon Grey، Pearl Black أو Pearl White.  {Crayon Grey | Pearl Black | Pearl White}
   Customer: ضمان الكوراج
     Bot: الكفالة لسيارة VOYAH Courage: 6 سنوات على السيارة و10 سنوات على البطارية.
   Customer: بدي اشتريها
     Bot: إليكم VOYAH Courage باللون Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: ممتاز. أبلغت فريق المبيعات برغبتكم في المضي قدماً بسيارة VOYAH Courage، وسيتابع معكم أحد أعضاء الفريق الخطوات التالية هنا مباشرةً.
     → ONE alert to Sales [hot] BUYING · COURAGE

31. Typos
   Customer: free318 rnge
     Bot: Here is the VOYAH Free 318 brochure.
     Bot: [brochure Voyah-free.pdf]
     Bot: The VOYAH Free 318 offers 318 km EV / 1,357 km combined (CLTC).
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Free 318 in British Racing Green, Midnight Black, Pearl White, Sage Green or Titanium Grey.  {British Racing Green | Midnight Black | Pearl White | Sage Green | Titanium Grey}
   Customer: corage prise
     Bot: Here is the VOYAH Courage brochure.
     Bot: [brochure Voyah-courage.pdf]
     Bot: Here is the VOYAH Courage in Pearl Black.
     Bot: [video Pearl-Black.mp4]
     Bot: Our Sales Team will assist you further right here with all the details you need.
     → ONE alert to Sales [qualified] PRICE · COURAGE

32. All brochures
   Customer: send me all the brochures
     Bot: Happy to send brochures. They are large files, so please tell me which model or models you'd like.
     Bot: Which model are you interested in?  {VOYAH Free 318 | VOYAH Courage | VOYAH Dream | VOYAH Passion | VOYAH Passion L | VOYAH Taishan | MHERO 1 | MHERO 2}
   Customer: VOYAH Taishan
     Bot: Here is the VOYAH Taishan brochure.
     Bot: [brochure Taishan.pdf]
     Bot: Which exterior colour would you like to see? We can show you the VOYAH Taishan in Obsidian Black, Sapphire Blue or Storm Grey.  {Obsidian Black | Sapphire Blue | Storm Grey}

```
