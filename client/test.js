const aptDateStr = "2026-06-03T00:00:00.000Z";
const aptDate = new Date(aptDateStr).toISOString().split('T')[0];
console.log("aptDate", aptDate);

const futureDateStr = "2026-06-05T00:00:00.000Z";
const futureDate = new Date(futureDateStr).toISOString().split('T')[0];
console.log("futureDate", futureDate);

const today = new Date().toISOString().split('T')[0];
console.log("today", today);
console.log("is future equal today?", futureDate === today);
