
const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = $("#menuBtn");
  const sidebar = $("#sidebar");
  const year = $("#year");
  const requestForm = $("#requestForm");
  const formMessage = $("#formMessage");

  if (year) year.textContent = new Date().getFullYear();

  // فتح وإغلاق قائمة الموبايل
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });

    sidebar.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        sidebar.classList.remove("open");
      });
    });
  }

  // اختيار منتج وإرساله إلى نموذج الطلب
  document.querySelectorAll(".productBtn").forEach((button) => {
    button.addEventListener("click", () => {
      const product = button.dataset.product || "تكييف";
      const type = $("#type");
      const details = $("#details");

      if (type) {
        const matchingOption = [...type.options].find((option) =>
          option.textContent.includes("شراء")
        );
        if (matchingOption) type.value = matchingOption.value;
      }

      if (details) details.value = `أرغب في الاستفسار عن: ${product}`;

      $("#request")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });

  // إرسال الطلب إلى الخادم؛ لا نعرض نجاحًا إلا بعد تأكيده
  if (requestForm) {
    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const submitButton = requestForm.querySelector(
        'button[type="submit"], button:not([type])'
      );

      const formData = new FormData(requestForm);
      const payload = Object.fromEntries(formData.entries());

      const phone = String(payload.phone || "").replace(/\s+/g, "");
      if (!payload.name || !phone) {
        showMessage("من فضلك اكتب الاسم ورقم الهاتف.", false);
        return;
      }

      if (submitButton) submitButton.disabled = true;
      showMessage("جارٍ إرسال طلبك...", true);

      try {
        const response = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || result.ok !== true) {
          throw new Error(result.error || "تعذر حفظ الطلب");
        }

        showMessage("تم تسجيل طلبك بنجاح، وسنتواصل معك قريبًا.", true);
        requestForm.reset();
      } catch (error) {
        showMessage(
          "لم يتم تأكيد تسجيل الطلب عبر الموقع. اتصل بنا أو راسلنا واتساب لإتمام طلبك.",
          false
        );
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  function showMessage(message, success) {
    if (!formMessage) {
      alert(message);
      return;
    }

    formMessage.textContent = message;
    formMessage.style.color = success ? "#16803d" : "#c62828";
    formMessage.setAttribute("role", "status");
  }
});
