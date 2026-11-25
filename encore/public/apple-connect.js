// חיבור Apple Music: MusicKit JS מבקש מהמשתמש הרשאה בחלון של Apple, ומחזיר Music User Token.
// את האסימון שולחים לשרת בטופס רגיל (עם csrf); הוא נשמר מוצפן ומשמש רק לקריאת הספרייה.
(() => {
  const btn = document.querySelector("[data-apple-connect]");
  if (!btn) return;
  const err = document.querySelector("[data-apple-error]");
  const ready = () =>
    new Promise((ok) => {
      if (window.MusicKit) return ok();
      document.addEventListener("musickitloaded", () => ok(), { once: true });
    });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    err.hidden = true;
    try {
      await ready();
      await MusicKit.configure({ developerToken: btn.dataset.devToken, app: { name: "JoCares", build: "1" } });
      const token = await MusicKit.getInstance().authorize();
      if (!token) throw new Error("no token");
      document.querySelector("[data-apple-token]").value = token;
      document.querySelector("[data-apple-form]").submit();
    } catch {
      err.hidden = false;
      btn.disabled = false;
    }
  });
})();
