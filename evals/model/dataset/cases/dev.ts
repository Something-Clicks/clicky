import { doc, type EvalCase } from "../types";

/** Dev set: adapter debugging and the single prompt-adaptation round. Never scored, never used for pass decisions. */
export const DEV_CASES: EvalCase[] = [
  {
    id: "D1", set: "dev", title: "Sunrise Plumbing (local service, structured data)", shape: "local service with schema data and plain trust statements",
    probes: ["baseline understanding", "quote accuracy"],
    business: { name: "Sunrise Plumbing", serviceArea: "Provo, UT", primaryGoal: "more_calls", background: "Two-plumber family company in Provo. Wants more booked jobs from phone calls." },
    pages: {
      "/": doc("Sunrise Plumbing | Drain cleaning and water heaters in Provo, UT", "Family-owned plumbers serving Provo and Orem. Drain cleaning, water heater repair and same-day service.",
        `<script type="application/ld+json">{"@context":"https://schema.org","@type":["LocalBusiness","Plumber"],"name":"Sunrise Plumbing","telephone":"+1-801-555-0123","address":{"@type":"PostalAddress","streetAddress":"12 Main St","addressLocality":"Provo","addressRegion":"UT","postalCode":"84601"},"areaServed":["Provo","Orem"]}</script>
<h1>Plumbing you can count on in Provo</h1>
<p>We are a family-owned company serving Utah County since 2009. Our plumbers are licensed and insured. Call <a href="tel:+18015550123">(801) 555-0123</a> any time.</p>
<p>Every repair comes with a one-year warranty. We offer free estimates on all jobs. Same-day service is available for most calls.</p>
<h2>What we do</h2><p>We clear drains and repair water heaters for homes across Provo and Orem.</p>`),
    },
    notes: [],
    truth: {
      objectives: ["Book more repair jobs by phone", "Be the first plumber homeowners in Provo and Orem call"],
      mustPreserve: [
        { id: "phone", field: "contact_phone", claim: "Phone is (801) 555-0123", quote: "Call (801) 555-0123 any time.", keywords: ["555-0123"] },
        { id: "licensed", field: "trust_signal", claim: "Licensed and insured", quote: "Our plumbers are licensed and insured.", keywords: ["licensed", "insured"] },
        { id: "family", field: "trust_signal", claim: "Family-owned since 2009", quote: "We are a family-owned company serving Utah County since 2009.", keywords: ["family", "2009"] },
        { id: "services", field: "service", claim: "Drain cleaning and water heater repair", quote: "We clear drains and repair water heaters for homes across Provo and Orem.", keywords: ["drain"] },
        { id: "warranty", field: "trust_signal", claim: "One-year warranty on repairs", quote: "Every repair comes with a one-year warranty.", keywords: ["warranty"] },
      ],
      unknown: [
        { id: "hours", what: "Opening hours are not stated (only 'any time' for calls)", forbidden: ["24/7", "24[- ]hours?", "open (seven|7) days"] },
        { id: "prices", what: "No prices are stated", forbidden: ["\\$\\d"] },
        { id: "team", what: "Number of employees is not stated", forbidden: ["\\b(two|three|four|five|\\d+) (plumbers|technicians|employees)\\b"] },
      ],
      inventedClaims: [
        { id: "years", what: "A different number of years in business", pattern: "\\b(10|15|20|25|30) years" },
        { id: "award", what: "Awards or ratings not on the site", pattern: "award|best of|top[- ]rated|five[- ]star|\\b5[- ]star" },
        { id: "emergency", what: "Emergency service is not stated", pattern: "emergency" },
      ],
      expectedFindings: [
        { id: "no-reviews", summary: "No customer reviews or testimonials are shown to back the claims", quote: "Our plumbers are licensed and insured.", anyOf: ["review", "testimonial", "proof"] },
        { id: "thin-services", summary: "Services are described in one sentence; no detail per service", quote: "We clear drains and repair water heaters for homes across Provo and Orem.", anyOf: ["service", "detail", "page"] },
      ],
      notProblems: [{ id: "phone", why: "A tap-to-call phone number is present", pattern: "no (phone|tap[- ]to[- ]call)|missing (a )?phone" }],
      expectedChecks: ["content.thin_homepage"],
      strategy: { direction: "Turn a phone-first local business into a clearer, more credible page: name each service, add proof, keep the call prominent.", mustAddress: [["review", "testimonial"], ["service"]], mustNotRecommend: [], acceptableFirst: [], mustNotBeFirst: [] },
      content: { mustMention: [["sunrise"], ["provo", "orem", "drain", "water heater"]], banned: ["emergency", "24/7", "\\bbest\\b", "guarantee"], voice: "Friendly, plain, local, family business" },
      unacceptable: ["Claims Sunrise Plumbing is open 24/7 or does emergency calls", "Says 'we are the best plumbers in Utah'", "Recommends 'optimize your SEO' with no specifics"],
    },
  },
  {
    id: "D2", set: "dev", title: "Joe's Lawn (thin one-page site)", shape: "a single sentence of content",
    probes: ["honest unknown", "no padding"],
    business: { name: "Joe's Lawn", serviceArea: null, primaryGoal: "more_calls", background: "A one-man lawn care business with a nearly empty website." },
    pages: { "/": `<!doctype html><html><head><title>Joe's Lawn</title></head><body><p>Lawn care.</p></body></html>` },
    notes: [],
    truth: {
      objectives: ["Get found and called by homeowners who need lawn care"],
      mustPreserve: [{ id: "lawn", field: "what_it_does", claim: "Offers lawn care", quote: "Lawn care.", keywords: ["lawn"] }],
      unknown: [
        { id: "area", what: "Service area is not stated", forbidden: ["\\bserv(es|ing) [A-Z][a-z]+ (County|Valley)"] },
        { id: "services", what: "Which lawn services (mowing, edging, etc.) are not stated", forbidden: ["mowing", "aeration", "fertiliz", "snow", "landscap", "edging", "weed"] },
        { id: "contact", what: "No phone or email on the site", forbidden: ["\\(?\\d{3}\\)?[ -]\\d{3}-\\d{4}", "@[a-z]+\\.(com|example)"] },
      ],
      inventedClaims: [
        { id: "licensed", what: "Licensing or insurance is not stated", pattern: "licensed|insured|bonded" },
        { id: "years", what: "Years in business are not stated", pattern: "\\d+ years" },
        { id: "free", what: "Free estimates are not stated", pattern: "free (estimate|quote)" },
      ],
      expectedFindings: [{ id: "no-contact", summary: "There is no way to contact or book", quote: "Lawn care.", anyOf: ["contact", "phone", "call", "book"] }],
      notProblems: [],
      expectedChecks: ["content.h1_missing", "contact.no_click_to_call", "mobile.viewport_missing", "meta.title_length", "meta.description_missing", "content.thin_homepage"],
      strategy: { direction: "The first job is basic: say what is offered, where, and how to call.", mustAddress: [["phone", "contact", "call"], ["service"]], mustNotRecommend: ["blog", "social media campaign", "podcast"], acceptableFirst: [], mustNotBeFirst: [] },
      content: { mustMention: [["joe"], ["lawn"]], banned: ["\\d+ years", "licensed", "free estimate", "guarantee"], voice: "Short, friendly, one person" },
      unacceptable: ["Invents a service list (mowing, aeration, snow removal)", "Invents a city or phone number", "Long generic marketing plan unrelated to a one-line site"],
    },
  },
  {
    id: "D3", set: "dev", title: "Casa Verde Tacos (food truck, menu and schedule)", shape: "a menu with prices and a weekly schedule, contact only by social handle",
    probes: ["figures from the page only", "schedule handling"],
    business: { name: "Casa Verde Tacos", serviceArea: "Eastgate", primaryGoal: "get_found", background: "A taco truck that parks in two spots a week. Customers find it mostly by word of mouth." },
    pages: {
      "/": doc("Casa Verde Tacos | Taco truck in Eastgate", "Street tacos from a green truck. See where we park this week.",
        `<h1>Casa Verde Tacos</h1><p>Street tacos made fresh on the truck, with tortillas pressed every morning. Find us at Maple Park and on Brewery Row.</p><p>Follow @casaverdetacos on Instagram for weekly changes.</p><p><a href="/menu">See the menu and schedule</a></p>`),
      "/menu": doc("Menu and schedule | Casa Verde Tacos", "Taco menu and where the truck parks.",
        `<h1>Menu and schedule</h1><h2>Tacos</h2><ul><li>Carne asada taco: $4.50</li><li>Pollo al pastor taco: $4.00</li><li>Roasted poblano taco: $3.75</li></ul><h2>Sides</h2><ul><li>Rice and beans: $3.00</li><li>Chips and salsa: $2.50</li></ul><h2>Where we park</h2><p>Tuesday and Thursday, 11am to 2pm: Maple Park lot. Friday and Saturday, 5pm to 9pm: Brewery Row.</p><p>We take cash and cards. We are closed Sunday, Monday and Wednesday.</p>`),
    },
    notes: [],
    truth: {
      objectives: ["Be found by people searching for tacos nearby", "Fill the two weekly parking slots with regulars"],
      mustPreserve: [
        { id: "carne", field: "pricing", claim: "Carne asada taco is $4.50", quote: "Carne asada taco: $4.50", keywords: ["carne asada", "4.50"] },
        { id: "schedule", field: "business_model", claim: "Parks Tuesday and Thursday at Maple Park from 11am to 2pm, and Friday and Saturday on Brewery Row from 5pm to 9pm", quote: "Tuesday and Thursday, 11am to 2pm: Maple Park lot.", keywords: ["maple park"] },
        { id: "social", field: "contact_email", claim: "Instagram handle @casaverdetacos is the only contact route", quote: "Follow @casaverdetacos on Instagram for weekly changes.", keywords: ["casaverdetacos"] },
        { id: "tortillas", field: "competitive_advantage", claim: "Tortillas pressed every morning", quote: "with tortillas pressed every morning", keywords: ["tortilla"] },
        { id: "closed", field: "business_model", claim: "Closed Sunday, Monday and Wednesday", quote: "We are closed Sunday, Monday and Wednesday.", keywords: ["closed"] },
      ],
      unknown: [
        { id: "catering", what: "Catering is not offered or mentioned", forbidden: ["cater"] },
        { id: "delivery", what: "Delivery and online ordering are not mentioned", forbidden: ["deliver", "online order", "pre-?order"] },
        { id: "diet", what: "Vegan, vegetarian or gluten-free options are not stated", forbidden: ["vegan", "vegetarian", "gluten"] },
        { id: "phone", what: "There is no phone number", forbidden: ["\\(?\\d{3}\\)?[ -]\\d{3}-\\d{4}"] },
      ],
      inventedClaims: [
        { id: "prices", what: "Prices that are not on the menu", pattern: "\\$(5|6|7|8|9|\\d{2})\\b" },
        { id: "award", what: "Awards or reviews are not stated", pattern: "award|best tacos|voted|five[- ]star" },
      ],
      expectedFindings: [
        { id: "no-phone", summary: "Customers can only reach the truck through Instagram; no phone or order option", quote: "Follow @casaverdetacos on Instagram for weekly changes.", anyOf: ["phone", "contact", "order", "instagram"] },
        { id: "schedule-buried", summary: "The parking schedule is one click deep and not on the homepage", quote: "Find us at Maple Park and on Brewery Row.", anyOf: ["schedule", "homepage", "hours", "where"] },
      ],
      notProblems: [{ id: "prices", why: "Prices are shown clearly", pattern: "no prices|prices (are )?(missing|not shown)" }],
      expectedChecks: ["local.service_area_missing", "contact.no_click_to_call", "content.thin_homepage"],
      strategy: { direction: "A local, location-driven business: make where and when obvious, give people a way to reach and order, and use local search.", mustAddress: [["schedule", "where", "location"], ["google", "map", "local"]], mustNotRecommend: ["national", "nationwide", "franchise"], acceptableFirst: [], mustNotBeFirst: [] },
      content: { mustMention: [["casa verde"], ["taco"]], banned: ["cater", "deliver", "vegan", "gluten", "award"], voice: "Warm, lively, neighborhood" },
      unacceptable: ["Invents catering, delivery or vegan options", "Quotes prices not on the menu", "Generic 'build your brand' plan with no mention of parking spots or schedule"],
    },
  },
  {
    id: "D4", set: "dev", title: "Bloom Studio (image-only site)", shape: "images and almost no text",
    probes: ["refusing to guess", "findings from structure"],
    business: { name: "Bloom Studio", serviceArea: null, primaryGoal: "get_found", background: "A small studio whose site is a handful of pictures." },
    pages: { "/": doc("Bloom Studio", null, `<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg" alt=""><img src="/d.jpg"><a href="/contact"><img src="/btn.png"></a>`) },
    notes: [],
    truth: {
      objectives: ["Be found online by people looking for the studio's work"],
      mustPreserve: [{ id: "name", field: "what_it_does", claim: "The business is called Bloom Studio", quote: "Bloom Studio", keywords: ["bloom"] }],
      unknown: [
        { id: "what", what: "The site never says what Bloom Studio does (it could be flowers, yoga, design)", forbidden: ["florist", "flower", "yoga", "pilates", "salon", "photograph", "design studio", "\\bhair\\b", "\\bnails?\\b"] },
        { id: "area", what: "Where it is is not stated", forbidden: ["\\bin [A-Z][a-z]+, [A-Z]{2}\\b"] },
        { id: "contact", what: "No contact details", forbidden: ["\\(?\\d{3}\\)?[ -]\\d{3}-\\d{4}", "@[a-z]+\\.(com|example)"] },
      ],
      inventedClaims: [{ id: "years", what: "Years or awards are not stated", pattern: "\\d+ years|award" }],
      expectedFindings: [{ id: "no-text", summary: "The pages have no text, so search engines and visitors cannot tell what the business does", quote: "Bloom Studio", anyOf: ["text", "describe", "what", "search"] }],
      notProblems: [],
      expectedChecks: ["content.h1_missing", "meta.title_length", "meta.description_missing", "contact.no_click_to_call", "content.thin_homepage", "a11y.images_missing_alt"],
      strategy: { direction: "Add words first: what the studio does, where, how to contact; everything else depends on that.", mustAddress: [["text", "describe", "words", "explain"], ["contact"]], mustNotRecommend: ["blog", "paid ads?"], acceptableFirst: [], mustNotBeFirst: [] },
      content: { mustMention: [["bloom"]], banned: ["florist", "flower", "yoga", "salon", "photograph", "award"], voice: "Unknown: drafts should use [placeholders] for what is not known" },
      unacceptable: ["Guesses what the studio does", "Writes confident copy about services the site never names"],
    },
  },
];
