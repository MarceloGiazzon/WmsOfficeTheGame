// Custom trusted-source field widget for Armazem.latitude: an interactive OpenStreetMap picker
// that manages BOTH latitude and longitude from a single widget instance.
//
// Design note (deliberate exception to the trusted-widget "no external calls" default): this
// widget loads real map tile images from tile.openstreetmap.org so it looks like an actual map,
// not just a coordinate pair. No JS/library is loaded from anywhere external -- only <img> tile
// requests -- but those ARE real third-party network calls, made with the app owner's explicit
// knowledge and approval (asked and confirmed before building this). OpenStreetMap's tile usage
// policy requires visible attribution, included below the map.
//
// Field-pair mechanics: this widget is declared only on "latitude" (ui.widget=custom). The
// sibling "longitude" field is declared as a perfectly normal string field with NO special
// widget -- it renders its default plain text input like any other field, and (uniquely) this
// widget hides that rendered wrapper and drives its value directly, rather than creating a
// second hidden input of its own. This only works because "longitude" is declared BEFORE
// "latitude" in Armazem.json's fields array, so its wrapper already exists in the DOM by the
// time this widget's render() runs (buildFormElement's field loop is fully synchronous). Because
// the real "longitude" <input> stays in the DOM (just visually hidden), it's still picked up by
// formFields()/submitForm's generic per-field payload loop like any other field -- no framework
// changes needed.
window.NpdevCustomWidgets.register("widgets/armazem-location-map.js", {
  render: function (field, value) {
    var VIEWPORT_W = 400;
    var VIEWPORT_H = 280;
    var TILE_SIZE = 256;
    var MIN_ZOOM = 2;
    var MAX_ZOOM = 18;
    var DEFAULT_ZOOM_WITH_LOCATION = 16;
    var DEFAULT_ZOOM_NO_LOCATION = 2;

    function toFloat(raw) {
      var n = parseFloat(raw);
      return isNaN(n) ? null : n;
    }

    // Sibling "longitude" field's own normally-rendered input/wrapper (see file header). Field
    // declaration order in Armazem.json does NOT reliably predict DOM render order (confirmed
    // live -- the platform reorders fields in the actual form), so this cannot assume longitude
    // is already in the DOM at this point. A MutationObserver fallback below handles the case
    // where it renders after latitude; this synchronous lookup is just the fast path for when it
    // already exists.
    var longitudeInput = document.querySelector('input[name="longitude"]');

    function hideLongitudeWrapper(input) {
      var wrapper = input.closest(".form-field");
      if (wrapper) { wrapper.style.display = "none"; }
    }

    // Default only the specific coordinate that's actually missing to 0 -- if longitude simply
    // hasn't rendered into the DOM yet (see the MutationObserver fallback below), that must not
    // clobber a real saved latitude back to 0.
    var initialLat = toFloat(value);
    var initialLon = longitudeInput ? toFloat(longitudeInput.value) : null;
    var state = {
      lat: initialLat === null ? 0 : initialLat,
      lon: initialLon === null ? 0 : initialLon,
      zoom: (initialLat === null || initialLon === null) ? DEFAULT_ZOOM_NO_LOCATION : DEFAULT_ZOOM_WITH_LOCATION
    };

    var wrapper = document.createElement("div");
    wrapper.className = "armazem-location-map-widget";

    var hiddenLat = document.createElement("input");
    hiddenLat.type = "hidden";
    hiddenLat.name = field.name;
    wrapper.appendChild(hiddenLat);

    var viewport = document.createElement("div");
    viewport.className = "armazem-location-map-viewport";
    viewport.style.position = "relative";
    viewport.style.width = VIEWPORT_W + "px";
    viewport.style.height = VIEWPORT_H + "px";
    viewport.style.overflow = "hidden";
    viewport.style.border = "1px solid #d8dee7";
    viewport.style.borderRadius = "6px";
    viewport.style.cursor = "crosshair";
    viewport.style.userSelect = "none";
    viewport.style.background = "#e9edf2";

    var tileLayer = document.createElement("div");
    tileLayer.style.position = "absolute";
    tileLayer.style.left = "0";
    tileLayer.style.top = "0";
    viewport.appendChild(tileLayer);

    var pin = document.createElement("div");
    pin.className = "armazem-location-map-pin";
    pin.style.position = "absolute";
    pin.style.left = (VIEWPORT_W / 2 - 10) + "px";
    pin.style.top = (VIEWPORT_H / 2 - 20) + "px";
    pin.style.width = "20px";
    pin.style.height = "20px";
    pin.style.pointerEvents = "none";
    pin.innerHTML = '<svg width="20" height="26" viewBox="0 0 20 26" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M10 0C4.48 0 0 4.48 0 10c0 7.5 10 16 10 16s10-8.5 10-16c0-5.52-4.48-10-10-10z" fill="#d92c2c"/>'
      + '<circle cx="10" cy="10" r="4" fill="#fff"/></svg>';
    viewport.appendChild(pin);

    var zoomControls = document.createElement("div");
    zoomControls.className = "armazem-location-map-zoom";
    zoomControls.style.position = "absolute";
    zoomControls.style.right = "8px";
    zoomControls.style.top = "8px";
    zoomControls.style.display = "flex";
    zoomControls.style.flexDirection = "column";
    zoomControls.style.gap = "4px";
    function zoomButton(label) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.width = "28px";
      b.style.height = "28px";
      b.style.cursor = "pointer";
      return b;
    }
    var zoomInBtn = zoomButton("+");
    var zoomOutBtn = zoomButton("−");
    zoomControls.appendChild(zoomInBtn);
    zoomControls.appendChild(zoomOutBtn);
    viewport.appendChild(zoomControls);

    wrapper.appendChild(viewport);

    var attribution = document.createElement("div");
    attribution.className = "armazem-location-map-attribution";
    attribution.style.fontSize = "11px";
    attribution.style.color = "#6b7280";
    attribution.style.marginTop = "4px";
    attribution.innerHTML = 'Mapa: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>';
    wrapper.appendChild(attribution);

    var precise = document.createElement("div");
    precise.className = "armazem-location-map-precise";
    precise.style.display = "flex";
    precise.style.gap = "8px";
    precise.style.marginTop = "6px";

    function preciseField(labelText) {
      var label = document.createElement("label");
      label.style.display = "flex";
      label.style.flexDirection = "column";
      label.style.fontSize = "12px";
      label.style.gap = "2px";
      var span = document.createElement("span");
      span.textContent = labelText;
      var input = document.createElement("input");
      input.type = "number";
      input.step = "0.000001";
      label.appendChild(span);
      label.appendChild(input);
      return { label: label, input: input };
    }
    var latField = preciseField("Latitude");
    var lonField = preciseField("Longitude");
    precise.appendChild(latField.label);
    precise.appendChild(lonField.label);
    wrapper.appendChild(precise);

    // -- Web Mercator projection helpers (standard slippy-map tile math) --
    function worldX(lon, zoom) {
      return (lon + 180) / 360 * TILE_SIZE * Math.pow(2, zoom);
    }
    function worldY(lat, zoom) {
      var latRad = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * TILE_SIZE * Math.pow(2, zoom);
    }
    function lonFromWorldX(x, zoom) {
      return x / (TILE_SIZE * Math.pow(2, zoom)) * 360 - 180;
    }
    function latFromWorldY(y, zoom) {
      var n = Math.PI - 2 * Math.PI * y / (TILE_SIZE * Math.pow(2, zoom));
      return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }

    function setHiddenValues() {
      var latText = state.lat.toFixed(6);
      var lonText = state.lon.toFixed(6);
      hiddenLat.value = latText;
      if (longitudeInput) {
        longitudeInput.value = lonText;
        longitudeInput.dispatchEvent(new Event("input", { bubbles: true }));
        longitudeInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      latField.input.value = latText;
      lonField.input.value = lonText;
    }

    function redraw() {
      var zoom = state.zoom;
      var tilesAcross = Math.pow(2, zoom);
      var centerWX = worldX(state.lon, zoom);
      var centerWY = worldY(state.lat, zoom);
      var topLeftWX = centerWX - VIEWPORT_W / 2;
      var topLeftWY = centerWY - VIEWPORT_H / 2;

      var firstCol = Math.floor(topLeftWX / TILE_SIZE);
      var lastCol = Math.floor((topLeftWX + VIEWPORT_W) / TILE_SIZE);
      var firstRow = Math.floor(topLeftWY / TILE_SIZE);
      var lastRow = Math.floor((topLeftWY + VIEWPORT_H) / TILE_SIZE);

      tileLayer.innerHTML = "";
      for (var row = firstRow; row <= lastRow; row++) {
        if (row < 0 || row >= tilesAcross) { continue; }
        for (var col = firstCol; col <= lastCol; col++) {
          var wrappedCol = ((col % tilesAcross) + tilesAcross) % tilesAcross;
          var img = document.createElement("img");
          img.src = "https://tile.openstreetmap.org/" + zoom + "/" + wrappedCol + "/" + row + ".png";
          img.width = TILE_SIZE;
          img.height = TILE_SIZE;
          img.alt = "";
          img.style.position = "absolute";
          img.style.left = (col * TILE_SIZE - topLeftWX) + "px";
          img.style.top = (row * TILE_SIZE - topLeftWY) + "px";
          tileLayer.appendChild(img);
        }
      }

      zoomOutBtn.disabled = zoom <= MIN_ZOOM;
      zoomInBtn.disabled = zoom >= MAX_ZOOM;
      setHiddenValues();
    }

    viewport.addEventListener("click", function (event) {
      var rect = viewport.getBoundingClientRect();
      var offsetX = event.clientX - rect.left;
      var offsetY = event.clientY - rect.top;
      var zoom = state.zoom;
      var centerWX = worldX(state.lon, zoom);
      var centerWY = worldY(state.lat, zoom);
      var topLeftWX = centerWX - VIEWPORT_W / 2;
      var topLeftWY = centerWY - VIEWPORT_H / 2;
      state.lon = lonFromWorldX(topLeftWX + offsetX, zoom);
      state.lat = latFromWorldY(topLeftWY + offsetY, zoom);
      redraw();
    });

    zoomInBtn.addEventListener("click", function () {
      if (state.zoom < MAX_ZOOM) { state.zoom += 1; redraw(); }
    });
    zoomOutBtn.addEventListener("click", function () {
      if (state.zoom > MIN_ZOOM) { state.zoom -= 1; redraw(); }
    });

    function applyPreciseInputs() {
      var lat = toFloat(latField.input.value);
      var lon = toFloat(lonField.input.value);
      if (lat === null || lon === null) { return; }
      state.lat = Math.max(-85, Math.min(85, lat));
      state.lon = Math.max(-180, Math.min(180, lon));
      if (state.zoom < DEFAULT_ZOOM_WITH_LOCATION) { state.zoom = DEFAULT_ZOOM_WITH_LOCATION; }
      redraw();
    }
    latField.input.addEventListener("change", applyPreciseInputs);
    lonField.input.addEventListener("change", applyPreciseInputs);

    if (longitudeInput) {
      hideLongitudeWrapper(longitudeInput);
    } else {
      // longitude hasn't rendered yet -- watch for it rather than assume an order. Once found,
      // if this is edit mode (a real saved latitude) and the map defaulted to (0,0) because
      // longitude's real value wasn't readable yet, adopt the now-discovered value and redraw so
      // the map opens centered on the actually-saved location, not the no-location default.
      var longitudeObserver = new MutationObserver(function () {
        var found = document.querySelector('input[name="longitude"]');
        if (!found) { return; }
        longitudeObserver.disconnect();
        longitudeInput = found;
        hideLongitudeWrapper(found);
        var discoveredLon = toFloat(found.value);
        var hadRealLatitude = toFloat(value) !== null;
        if (discoveredLon !== null && hadRealLatitude) {
          state.lon = discoveredLon;
          state.zoom = DEFAULT_ZOOM_WITH_LOCATION;
          redraw();
        } else {
          setHiddenValues();
        }
      });
      longitudeObserver.observe(document.body, { childList: true, subtree: true });
    }

    redraw();
    return wrapper;
  }
});
