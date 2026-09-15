'use strict';

(function () {

  function haversine(lat1, lng1, lat2, lng2) {
    function toRad(x) { return x * Math.PI / 180; }
    var R = 6371000;
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function requestBrowserLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ success: false, error: 'GEOLOCATION_UNSUPPORTED' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            success: true,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        function (err) {
          var code = 'UNKNOWN';
          if (err.code === 1) code = 'PERMISSION_DENIED';
          else if (err.code === 2) code = 'POSITION_UNAVAILABLE';
          else if (err.code === 3) code = 'TIMEOUT';
          resolve({ success: false, error: code });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  function validateLocation(lat, lng) {
    var cfg = (window.SUPABASE_CONFIG || {}).schoolGate;
    if (!cfg || !cfg.latitude || !cfg.longitude) {
      return { skipped: true, reason: 'SCHOOL_GATE_NOT_CONFIGURED' };
    }
    var dist = haversine(lat, lng, cfg.latitude, cfg.longitude);
    var ok = dist <= (cfg.radiusMeters || 30);
    return {
      skipped: false,
      ok: ok,
      distance: Math.round(dist),
      radius: cfg.radiusMeters || 30
    };
  }

  window.SBPag = window.SBPag || {};
  window.SBPag.haversine = haversine;
  window.SBPag.requestBrowserLocation = requestBrowserLocation;
  window.SBPag.validateLocation = validateLocation;

})();
