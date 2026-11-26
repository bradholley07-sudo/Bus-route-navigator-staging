const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.addInitScript(() => {
      const makeLayer = () => ({
        addTo() { return this; },
        on() { return this; },
        bindPopup(html) { this.popup = html; return this; }
      });
      window.__leafletMarkers = [];
      window.__leafletLines = [];
      window.L = {
        map() {
          return {
            remove() {},
            invalidateSize() {},
            fitBounds() {},
            setView() {}
          };
        },
        tileLayer() { return makeLayer(); },
        polyline(points) {
          const layer = makeLayer();
          layer.points = points;
          window.__leafletLines.push(layer);
          return layer;
        },
        marker(coords) {
          const layer = makeLayer();
          layer.coords = coords;
          window.__leafletMarkers.push(layer);
          return layer;
        },
        latLngBounds(points) { return points; }
      };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition() {},
          watchPosition() { return 1; },
          clearWatch() {}
        }
      });
      localStorage.setItem("busList", JSON.stringify([{ id: "101", number: "101" }]));
      localStorage.setItem("busRoutes", JSON.stringify([{
        id: "501",
        name: "Test Morning",
        mode: "Morning",
        busId: "101",
        busNumber: "101",
        stops: [
          { number: 1, name: "Oak Street", type: "Student Pickup", latitude: 33.5, longitude: -86.8, accuracy: 5 },
          { number: 2, name: "School", type: "School", latitude: 33.51, longitude: -86.81, accuracy: 5 }
        ]
      }]));
    });

    await page.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.goto("file://" + path.resolve("index.html"));
    await page.getByRole("button", { name: /Route Map \/ Edit Stops/ }).click();

    if (await page.locator("#routePreviewMap").isVisible()) throw new Error("Regular preview map should be hidden before route selection");
    if (await page.locator("#routePreviewStartButton").isVisible()) throw new Error("Start Route should be hidden before route selection");

    await page.locator("#regularRouteChoice").selectOption("501");
    await page.getByRole("button", { name: /Preview Selected Route/ }).click();

    const regularStops = await page.locator("#routePreviewStopList .preview-stop").allInnerTexts();
    if (regularStops.length !== 2 || !regularStops.join(" ").includes("Oak Street") || !regularStops.join(" ").includes("School")) {
      throw new Error("Regular preview list did not show every saved stop");
    }
    if (!(await page.locator("#routePreviewMap").isVisible())) throw new Error("Regular preview map is hidden");
    if (!(await page.locator("#routePreviewStartButton").isVisible())) throw new Error("Start Route button is missing after route selection");

    const regularMap = await page.evaluate(() => ({
      markerCount: window.__leafletMarkers.length,
      linePoints: window.__leafletLines.at(-1)?.points || [],
      firstPopup: window.__leafletMarkers.at(-2)?.popup || ""
    }));
    if (regularMap.markerCount !== 2) throw new Error("Regular route map did not render both saved stop markers");
    if (regularMap.linePoints.length !== 2) throw new Error("Regular route map did not connect saved stop coordinates");
    if (!regularMap.firstPopup.includes("previewStopName") || !regularMap.firstPopup.includes("Save Name")) {
      throw new Error("Regular driver map marker does not expose stop-name editing");
    }

    const renamed = await page.evaluate(() => {
      const popup = document.createElement("div");
      popup.innerHTML = window.__leafletMarkers.at(-2).popup;
      document.body.appendChild(popup);
      const input = popup.querySelector("input");
      const save = popup.querySelector("button");
      if (!input || !save) throw new Error("Regular driver popup editor is missing");
      input.value = "Oak Street Renamed";
      save.click();
      popup.remove();
      return JSON.parse(localStorage.getItem("busRoutes"))[0].stops[0].name;
    });
    if (renamed !== "Oak Street Renamed") throw new Error("Regular driver stop-name edit did not persist");

    await page.getByRole("button", { name: /Start This Route/ }).click();
    if (!(await page.locator("#navigationPanel").isVisible())) throw new Error("Start Route did not enter existing navigation");
    if (!(await page.locator("#nextStop").innerText()).includes("Oak Street Renamed")) {
      throw new Error("Navigation did not load the selected route with the saved stop name");
    }

    await page.evaluate(() => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      goHome();
    });
    await page.getByRole("button", { name: /Start Route/ }).click();
    await page.locator("#routeSelect").selectOption("501");
    await page.getByRole("button", { name: /Preview Route Map/ }).click();

    const substituteStops = await page.locator("#routePreviewStopList .preview-stop").allInnerTexts();
    if (substituteStops.length !== 2 || !substituteStops.join(" ").includes("Oak Street Renamed") || !substituteStops.join(" ").includes("School")) {
      throw new Error("Substitute preview list did not show every saved stop");
    }
    const substitutePopups = await page.evaluate(() => window.__leafletMarkers.slice(-2).map(marker => marker.popup || ""));
    if (substitutePopups.length !== 2 || substitutePopups.some(popup => /<input|<button/i.test(popup))) {
      throw new Error("Substitute preview marker popup is not read-only");
    }
    if (await page.locator("#routePreviewStopList").innerText().then(text => text.includes("Tap map marker to rename"))) {
      throw new Error("Substitute preview shows regular-driver editing instructions");
    }

    await page.getByRole("button", { name: /Start This Route/ }).click();
    if (!(await page.locator("#navigationPanel").isVisible())) throw new Error("Substitute Start Route did not enter existing navigation");
    if (!(await page.locator("#nextStop").innerText()).includes("Oak Street Renamed")) {
      throw new Error("Substitute navigation did not load the selected saved route");
    }
    if (errors.length) throw new Error("Browser errors: " + errors.join("; "));

    console.log("PASS: syntax, regular-driver stop editing, substitute read-only preview, saved map/list stops, and both navigation handoffs");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
