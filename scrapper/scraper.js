/**
 * scraper-gerar-sinais.js
 * Scraper completo do /gerar-sinais:
 *  - lista todos os jogos
 *  - entra em cada jogo, tenta clicar "GERAR SINAL"
 *  - salva JSON + screenshots antes/depois
 *
 * npm i puppeteer
 * node scraper-gerar-sinais.js
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SITE_URL = "https://www.grupofpsinais.com";
const START_URL = SITE_URL + "/gerar-sinais";

const OUT_DIR = path.join(__dirname, "export", "gerar-sinais");
const GAMES_DIR = path.join(OUT_DIR, "games");
const SHOTS_DIR = path.join(OUT_DIR, "screenshots");

for (const dir of [OUT_DIR, GAMES_DIR, SHOTS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeUrl(url) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return SITE_URL + url;
    return SITE_URL + "/" + url;
}

async function closePopupIfExists(page) {
    const selectors = [
        "button.absolute.rounded-full",
        ".absolute.right-5.top-5",
        "button:has(svg.lucide-x)",
        'button:has(path[d="M18 6 6 18"])',
    ];
    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn) {
                await btn.click();
                return true;
            }
        } catch { }
    }
    return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        for (const btn of buttons) {
            const svg = btn.querySelector("svg");
            if (svg && btn.classList.contains("absolute") && btn.classList.contains("rounded-full")) {
                btn.click();
                return true;
            }
        }
        return false;
    });
}

async function smartScroll(page, step = 1100) {
    return page.evaluate((stepPx) => {
        const beforeWin = window.scrollY || document.documentElement.scrollTop || 0;
        window.scrollBy(0, stepPx);
        const afterWin = window.scrollY || document.documentElement.scrollTop || 0;
        const movedWin = afterWin - beforeWin;

        if (Math.abs(movedWin) > 0) return { moved: movedWin, mode: "window" };

        const candidates = Array.from(document.querySelectorAll("*")).filter((el) => {
            const st = window.getComputedStyle(el);
            const oy = st.overflowY;
            if (oy !== "auto" && oy !== "scroll") return false;
            return el.scrollHeight - el.clientHeight > 300;
        });

        candidates.sort(
            (a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
        );

        const scroller = candidates[0];
        if (!scroller) return { moved: 0, mode: "none" };

        const before = scroller.scrollTop;
        scroller.scrollBy(0, stepPx);
        const after = scroller.scrollTop;

        return { moved: after - before, mode: "container" };
    }, step);
}

async function forceToTop(page) {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        const candidates = Array.from(document.querySelectorAll("*")).filter((el) => {
            const st = window.getComputedStyle(el);
            const oy = st.overflowY;
            if (oy !== "auto" && oy !== "scroll") return false;
            return el.scrollHeight - el.clientHeight > 300;
        });
        for (const el of candidates) el.scrollTop = 0;
    });
    await sleep(600);
}

async function scrollToLoadAll(page) {
    let stable = 0;
    let lastCount = 0;

    for (let i = 0; i < 700; i++) {
        const count = await page.evaluate(() => {
            return document.querySelectorAll('div.game.rounded-xl a[href^="/gerar-sinais/"]').length;
        });

        if (i % 25 === 0) console.log(`   📦 loop ${i} | jogos visíveis: ${count}`);

        if (count === lastCount) stable++;
        else stable = 0;

        lastCount = count;

        if (stable >= 30) {
            console.log(`   🧱 estabilizou em ${count} jogos`);
            break;
        }

        const sc = await smartScroll(page, 1100);
        await sleep(220);
        if (!sc.moved) {
            await page.keyboard.press("PageDown");
            await sleep(220);
        }
    }
}

async function extractGameList(page) {
    const list = await page.evaluate(() => {
        function decodeNextUrl(url) {
            if (!url) return "";
            const m = url.match(/[?&]url=([^&]+)/);
            if (m) {
                try {
                    return decodeURIComponent(m[1]);
                } catch {
                    return url;
                }
            }
            return url;
        }

        function bestFromSrcset(src, srcset) {
            if (srcset && srcset.trim()) {
                const parts = srcset.split(",").map((s) => s.trim());
                const last = parts[parts.length - 1] || "";
                const u = last.split(" ")[0] || "";
                if (u) return u;
            }
            return src || "";
        }

        const cards = Array.from(document.querySelectorAll("div.game.rounded-xl")).map((card) => {
            const a = card.querySelector('a[href^="/gerar-sinais/"]');
            if (!a) return null;

            const href = a.getAttribute("href") || "";
            const slug = href.split("/").filter(Boolean).pop() || null;

            const img = a.querySelector("img");
            const src = img ? img.getAttribute("src") : "";
            const srcset = img ? img.getAttribute("srcset") : "";
            const best = bestFromSrcset(src, srcset);
            const image = decodeNextUrl(best);

            const style = card.getAttribute("style") || "";
            const bgMatch = style.match(/background-color:\s*([^;]+)/i);
            const bgColor = bgMatch ? bgMatch[1].trim() : null;

            const titleSpan = card.querySelector(".gameContent span");
            const title = titleSpan ? (titleSpan.textContent || "").trim() : slug;

            const noteP = card.querySelector("p");
            const note = noteP ? (noteP.textContent || "").trim() : null;

            return { slug, title, href, image, bgColor, note };
        });

        return cards.filter(Boolean);
    });

    // dedup por slug/href
    const map = new Map();
    for (const g of list) {
        const key = g.slug || g.href;
        if (!map.has(key)) map.set(key, g);
    }
    return Array.from(map.values());
}

async function extractGameDetails(page) {
    const data = await page.evaluate(() => {
        function decodeNextUrl(url) {
            if (!url) return "";
            const m = url.match(/[?&]url=([^&]+)/);
            if (m) {
                try {
                    return decodeURIComponent(m[1]);
                } catch {
                    return url;
                }
            }
            return url;
        }

        function bestFromSrcset(src, srcset) {
            if (srcset && srcset.trim()) {
                const parts = srcset.split(",").map((s) => s.trim());
                const last = parts[parts.length - 1] || "";
                const u = last.split(" ")[0] || "";
                if (u) return u;
            }
            return src || "";
        }

        // pega o “card grande” de detalhes
        const root = document.querySelector("div.game.rounded-xl") || document.body;

        // imagem principal do jogo
        const mainImg = root.querySelector('img[alt]');
        const src = mainImg ? mainImg.getAttribute("src") : "";
        const srcset = mainImg ? mainImg.getAttribute("srcset") : "";
        const image = decodeNextUrl(bestFromSrcset(src, srcset));
        const alt = mainImg ? mainImg.getAttribute("alt") : null;

        // tenta achar os 3 blocos NORMAL/TURBO/JOGUE ATÉ
        const rows = Array.from(root.querySelectorAll("div")).filter((d) =>
            /NORMAL:|TURBO:|JOGUE ATÉ:/i.test(d.textContent || "")
        );

        function pickValue(label) {
            const row = rows.find((r) => (r.textContent || "").toUpperCase().includes(label));
            if (!row) return null;

            // geralmente tem <h1>LABEL</h1><span>VALOR</span>
            const spans = Array.from(row.querySelectorAll("span"));
            const lastSpan = spans.length ? spans[spans.length - 1] : null;
            const value = lastSpan ? (lastSpan.textContent || "").trim() : null;
            return value || null;
        }

        const normal = pickValue("NORMAL:");
        const turbo = pickValue("TURBO:");
        const jogueAte = pickValue("JOGUE ATÉ:");

        // tenta achar o botão "GERAR SINAL"
        const btn = Array.from(root.querySelectorAll("button, a")).find((el) =>
            (el.textContent || "").toUpperCase().includes("GERAR SINAL")
        );

        return {
            alt,
            image,
            normal,
            turbo,
            jogueAte,
            hasGenerateButton: !!btn,
        };
    });

    return data;
}

/**
 * Clica "GERAR SINAL" e captura mudanças:
 * - snapshot do texto do root antes/depois (resumo)
 */
async function clickGenerateAndProbe(page) {
    // tenta clicar por texto
    const clicked = await page.evaluate(() => {
        const root = document.querySelector("div.game.rounded-xl") || document.body;

        const candidates = Array.from(root.querySelectorAll("button")).filter((b) =>
            (b.textContent || "").toUpperCase().includes("GERAR SINAL")
        );

        if (candidates.length) {
            candidates[0].click();
            return true;
        }

        // fallback: qualquer element clicável com esse texto
        const any = Array.from(root.querySelectorAll("a,[role='button'],div,span")).find((el) =>
            (el.textContent || "").toUpperCase().includes("GERAR SINAL")
        );
        if (any) {
            any.click();
            return true;
        }

        return false;
    });

    if (!clicked) return { clicked: false, before: null, after: null };

    // espera algo mudar
    await sleep(1200);

    // pega um resumo do texto do card principal (pra ver se trocou de -- pra algo)
    const after = await page.evaluate(() => {
        const root = document.querySelector("div.game.rounded-xl") || document.body;
        const txt = (root.textContent || "").replace(/\s+/g, " ").trim();
        // limita tamanho
        return txt.slice(0, 1200);
    });

    return { clicked: true, after };
}

async function main() {
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 10,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--force-device-scale-factor=1"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });

    console.log("🌐 Abrindo /gerar-sinais...");
    await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(2200);

    await closePopupIfExists(page);
    await sleep(700);

    console.log("📜 Rolando para carregar todos os jogos...");
    await scrollToLoadAll(page);

    console.log("🔎 Extraindo lista de jogos...");
    const list = await extractGameList(page);

    const listNormalized = list.map((g) => ({
        ...g,
        href: normalizeUrl(g.href),
        image: normalizeUrl(g.image),
    }));

    fs.writeFileSync(path.join(OUT_DIR, "list.json"), JSON.stringify(listNormalized, null, 2), "utf8");
    console.log(`✅ list.json salvo com ${listNormalized.length} jogos`);

    // Agora entra em cada jogo e captura detalhes
    for (let i = 0; i < listNormalized.length; i++) {
        const g = listNormalized[i];
        const slug = g.slug || `game-${i + 1}`;
        const url = normalizeUrl(g.href);

        console.log(`\n🎮 [${i + 1}/${listNormalized.length}] Abrindo ${slug}...`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(1700);

        await closePopupIfExists(page);
        await sleep(500);
        await forceToTop(page);

        const beforeShot = path.join(SHOTS_DIR, `${slug}-before.png`);
        await page.screenshot({ path: beforeShot, fullPage: true });

        const detailsBefore = await extractGameDetails(page);

        // tenta clicar gerar sinal e capturar depois
        const clickResult = await clickGenerateAndProbe(page);

        const afterShot = path.join(SHOTS_DIR, `${slug}-after.png`);
        await page.screenshot({ path: afterShot, fullPage: true });

        // captura de novo (às vezes muda NORMAL/TURBO/JOGUE ATÉ)
        const detailsAfter = await extractGameDetails(page);

        const out = {
            slug,
            url,
            listInfo: g,
            before: detailsBefore,
            after: detailsAfter,
            generateClick: clickResult,
            screenshots: {
                before: `screenshots/${slug}-before.png`,
                after: `screenshots/${slug}-after.png`,
            },
            capturedAt: new Date().toISOString(),
        };

        fs.writeFileSync(path.join(GAMES_DIR, `${slug}.json`), JSON.stringify(out, null, 2), "utf8");
        console.log(`✅ Salvo games/${slug}.json`);
    }

    console.log("\n🎉 Finalizado! Veja export/gerar-sinais/");
    await browser.close();
}

main().catch((e) => {
    console.error("ERRO:", e);
    process.exit(1);
});