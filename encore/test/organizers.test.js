import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, insert } from "../src/db.js";
import { clock, emailHash } from "../src/util.js";
import * as ID from "../src/domain/identity.js";
import * as C from "../src/domain/campaigns.js";
import * as M from "../src/domain/money.js";
import * as T from "../src/domain/tickets.js";
import { sandboxPay } from "../src/payments/sandbox.js";

let db, barby;
const SHOW = {
  organizer_kind: "venue", organizer_name: "הבארבי", venue: "הבארבי", city: "תל אביב", starts_at: "2026-12-20T21:00",
  price: "100", reward: "20", image_url: "https://img.example/a.jpg", ticketing: "jocares", capacity: "400",
};
beforeEach(() => {
  clock.set("2026-12-01T10:00:00.000Z");
  db = openDb(":memory:");
  barby = ID.getUser(db, insert(db, "users", { email: "ops@barby.example", email_hash: emailHash("ops@barby.example"), name: "צוות הבארבי", created_at: clock.iso() }));
});
after(() => clock.set(null));

test("מקום מוכר הופעות של כמה אמנים: מארגן אחד, חשבון כסף אחד, ובכל הופעה מוצג מי שמופיע", () => {
  const a = C.getCampaign(db, C.createCampaign(db, barby, { ...SHOW, artist_name: "נועה ברק", title: "ערב אקוסטי" }));
  const b = C.getCampaign(db, C.createCampaign(db, barby, { ...SHOW, artist_name: "הקרוואן", title: "השקת אלבום" }));
  assert.equal(a.artist_id, b.artist_id);
  assert.deepEqual([a.artist_name, b.artist_name], ["נועה ברק", "הקרוואן"]);
  assert.equal(a.organizer_name, "הבארבי");
  assert.equal(a.organizer_kind, "venue");
  assert.equal(ID.artistsOf(db, barby.id).length, 1);
  M.saveArtistPayout(db, barby, a.artist_id, { type: "company", legal_name: "הבארבי בע״מ", tax_id: "515555555", phone: "035555555", bank: "הפועלים", branch: "600", account: "999999", confirm: "on" });
  assert.equal(M.artistPayout(db, b.artist_id).legal_name, "הבארבי בע״מ");
  const o = T.createOrder(db, b.id, { name: "קונה", email: "x@y.com", qty: 2 });
  T.startPayment(db, o, { origin: "x" });
  sandboxPay(db, T.ticketOrder(db, o.id).payment_ref, "4242424242424242");
  T.returnFromPayment(db, T.ticketOrder(db, o.id));
  assert.equal(M.showStatement(db, b.id).gross, 20000);
  assert.equal(M.showStatement(db, a.id).gross, 0);
});

test("מקום חייב שם, ואמן שמוכר בעצמו לא צריך", () => {
  assert.throws(() => C.createCampaign(db, barby, { ...SHOW, organizer_name: "", artist_name: "נועה", title: "x" }), /שם המקום/);
  const c = C.getCampaign(db, C.createCampaign(db, barby, { ...SHOW, organizer_kind: "artist", organizer_name: "", artist_name: "נועה ברק", title: "x" }));
  assert.equal(c.organizer_name, "נועה ברק");
  assert.equal(c.artist_name, "נועה ברק");
});
