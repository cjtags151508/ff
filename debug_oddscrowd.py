from playwright.sync_api import sync_playwright

URL = "https://oddscrowd.com/odds-comparison/basketball/leagues/ncaab/bet-types/spread-fullgame"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # visible browser
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(4000)

        # scroll to trigger lazy-load
        for _ in range(12):
            page.mouse.wheel(0, 1200)
            page.wait_for_timeout(400)

        previews = page.locator("a:has-text('Game Preview')")
        print("Game Preview links:", previews.count())

        body_text = page.locator("body").inner_text()
        print("Percent signs in body:", body_text.count("%"))

        page.screenshot(path="oddscrowd_debug.png", full_page=True)
        with open("oddscrowd_debug.html", "w", encoding="utf-8") as f:
            f.write(page.content())

        print("Saved oddscrowd_debug.png and oddscrowd_debug.html")
        input("Press Enter to close...")
        browser.close()

if __name__ == "__main__":
    main()
