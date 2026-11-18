import { describe, expect, it } from "vitest";
import { contentAddedMessage } from "@/lib/content/notify-added";

const base = { title: "Diwali greetings reel", type: "video", category: "festival", addedByName: "Dhvani Patel", origin: "https://crm.example.com/" };

describe("Content Library 'new content' message", () => {
  it("says who added what, and links to the library", () => {
    const m = contentAddedMessage(base);
    expect(m.title).toBe("New in the Content Library: Diwali greetings reel");
    expect(m.body).toBe("Dhvani Patel added a video in festival.");
    expect(m.url).toBe("https://crm.example.com/dashboard/content-library");
    expect(m.subject).toContain("Diwali greetings reel");
    expect(m.text).toContain(m.url);
    expect(m.html).toContain(m.url);
  });

  it("leaves out a 'general' category and reads cleanly", () => {
    expect(contentAddedMessage({ ...base, category: "general" }).body).toBe("Dhvani Patel added a video.");
    expect(contentAddedMessage({ ...base, type: "one_pager", category: "general" }).body).toBe("Dhvani Patel added a one pager.");
  });

  it("escapes anything typed by the uploader in the email", () => {
    const m = contentAddedMessage({ ...base, title: "<script>x</script> & more", addedByName: "A <b>B" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&amp; more");
  });
});
