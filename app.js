/* SafeCircle — Real-time family safety prototype
   Uses real device GPS for the primary user.
   Other members use realistic live simulation anchored around the user's real position.
   Battery API used when available. All UI updates are live. */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  const members = [];
  let zones = [];
  let activities = [];
  const markers = {};
  const circles = {};
  const previousState = {};
  let timer = null;
  let paused = false;
  let map = null;
  let userWatchId = null;
  let lastRealPos = null;
  let accuracy = null;

  // Colour palette for members
  const COLORS = [
    { color: '#3b82f6', cls: 'blue' },
    { color: '#14b8a6', cls: 'teal' },
    { color: '#8b5cf6', cls: 'violet' },
    { color: '#f59e0b', cls: 'amber' },
    { color: '#ec4899', cls: 'pink' },
    { color: '#10b981', cls: 'emerald' }
  ];

  // ── Helpers ────────────────────────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function isInside(m, z) {
    return haversine(m.lat, m.lng, z.lat, z.lng) <= z.radius;
  }

  function zoneFor(m) {
    return zones.find(z => isInside(m, z));
  }

  function timeAgo(ts) {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    return Math.floor(sec / 3600) + 'h ago';
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function setStatus(text, online = true) {
    document.getElementById('statusText').textContent = text;
    document.getElementById('connectionStatus').classList.toggle('offline', !online);
  }

  // ── Map ────────────────────────────────────────────────────────────────
  function initMap(lat, lng) {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([lat, lng], 15);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);
  }

  function icon(m) {
    return L.divIcon({
      className: '',
      html: `<div class="custom-marker" style="background:${m.color}">${m.initials}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function renderMap() {
    if (!map) return;
    zones.forEach(z => {
      if (circles[z.id]) map.removeLayer(circles[z.id]);
      circles[z.id] = L.circle([z.lat, z.lng], {
        radius: z.radius,
        color: z.color,
        weight: 2,
        fillOpacity: 0.1,
        fillColor: z.color
      })
        .addTo(map)
        .bindPopup(`<b>${z.name}</b><br>${z.radius} m safe zone`);
    });

    members.forEach(m => {
      if (!markers[m.id]) {
        markers[m.id] = L.marker([m.lat, m.lng], { icon: icon(m) }).addTo(map);
      } else {
        markers[m.id].setLatLng([m.lat, m.lng]);
      }
      const z = zoneFor(m);
      const acc = m.isSelf && accuracy != null ? `<br>Accuracy ±${Math.round(accuracy)} m` : '';
      markers[m.id].bindPopup(
        `<b>${m.name}</b><br>${z ? 'Inside ' + z.name : 'Outside all safe zones'}<br>Battery ${m.battery}%${acc}`
      );
    });
  }

  // ── UI render ──────────────────────────────────────────────────────────
  function renderMembers() {
    const list = document.getElementById('memberList');
    const grid = document.getElementById('membersGrid');
    list.innerHTML = members
      .map(m => {
        const z = zoneFor(m);
        const low = m.battery < 20;
        return `
          <div class="member-row ${m.isSelf ? 'self' : ''}">
            <div class="avatar ${m.cls}">${m.initials}</div>
            <div>
              <b>${m.name}${m.isSelf ? ' (You)' : ''}</b>
              <span>${z ? 'Inside ' + z.name : 'Outside safe zones'} · ${timeAgo(m.lastUpdate)}</span>
            </div>
            <div class="battery ${low ? 'low' : ''}">${m.battery}%</div>
          </div>`;
      })
      .join('');

    grid.innerHTML = members
      .map(
        m => `
        <article>
          <div class="avatar ${m.cls}">${m.initials}</div>
          <div>
            <b>${m.name}</b>
            <p>${m.role} · ${m.isSelf ? 'Real GPS' : 'Live simulation'}</p>
          </div>
          <div class="facts">
            <span>Battery <b>${m.battery}%</b></span>
            <span>Status <b style="color:var(--green)">Online</b></span>
            <span>Updated <b>${timeAgo(m.lastUpdate)}</b></span>
          </div>
        </article>`
      )
      .join('');

    document.getElementById('memberCount').textContent = members.length;
    document.getElementById('sharingCount').textContent = members.length + ' sharing now';
    document.getElementById('insideCount').textContent = members.filter(zoneFor).length;

    const zoneNames = [...new Set(members.map(m => zoneFor(m)?.name).filter(Boolean))];
    document.getElementById('zoneSummary').textContent =
      zoneNames.length ? zoneNames.join(' + ') : 'None';
  }

  function eventIcon(a) {
    if (a.type === 'sos') return 'SOS';
    if (a.type === 'battery') return '↯';
    if (a.type === 'entry') return '✓';
    if (a.type === 'exit') return '↗';
    return '↻';
  }

  function renderActivities() {
    const dangerCount = activities.filter(a => a.danger && !a.read).length;
    document.getElementById('openAlerts').textContent = dangerCount;
    document.getElementById('alertBadge').textContent = dangerCount || '';

    const html = activities
      .map(
        a => `
        <div class="activity-item ${a.danger && !a.read ? 'unread' : ''}">
          <div class="event-icon ${a.danger ? 'danger' : a.good ? 'good' : ''}">${eventIcon(a)}</div>
          <div>
            <b>${a.title}</b>
            <p>${a.body}</p>
          </div>
          <time>${timeAgo(a.ts)}</time>
        </div>`
      )
      .join('');

    document.getElementById('allActivities').innerHTML = html || '<p class="empty">No alerts yet</p>';
    document.getElementById('activityPreview').innerHTML =
      activities
        .slice(0, 5)
        .map(
          a => `
        <div class="activity-item">
          <div class="event-icon ${a.danger ? 'danger' : a.good ? 'good' : ''}">${eventIcon(a)}</div>
          <div>
            <b>${a.title}</b>
            <p>${a.body}</p>
          </div>
          <time>${timeAgo(a.ts)}</time>
        </div>`
        )
        .join('') || '<p class="empty">Waiting for activity…</p>';
  }

  function renderZones() {
    document.getElementById('zoneList').innerHTML =
      zones
        .map(
          z => `
        <div class="zone-row">
          <i class="zone-color" style="background:${z.color}"></i>
          <div>
            <b>${z.name}</b>
            <span>${z.radius} m radius · ${members.filter(m => isInside(m, z)).length} inside</span>
          </div>
          <button class="secondary small" onclick="window.focusZone(${z.id})">View</button>
        </div>`
        )
        .join('') || '<p class="empty">No zones yet. Create one at the map centre.</p>';
  }

  function refresh() {
    renderMap();
    renderMembers();
    renderZones();
    renderActivities();
    document.getElementById('lastSync').textContent = 'Now';
    if (accuracy != null) {
      document.getElementById('accuracyInfo').textContent = `±${Math.round(accuracy)} m`;
    }
  }

  function addActivity(a) {
    a.ts = Date.now();
    a.read = false;
    activities.unshift(a);
    if (activities.length > 80) activities.pop();
    renderActivities();
  }

  // ── Real GPS for self ──────────────────────────────────────────────────
  function startRealLocation() {
    if (!navigator.geolocation) {
      setStatus('GPS unavailable — demo mode', false);
      bootstrapDemoMode(28.6139, 77.2090); // Delhi fallback
      return;
    }

    setStatus('Requesting location…');

    const opts = { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 };

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        accuracy = acc;
        lastRealPos = { lat: latitude, lng: longitude };
        initMap(latitude, longitude);
        ensureSelfMember(latitude, longitude);
        bootstrapDemoMembers(latitude, longitude);
        bootstrapDefaultZones(latitude, longitude);
        setStatus('Live GPS connected');
        refresh();
        startWatch();
        startSimulation();
      },
      err => {
        console.warn('Geolocation error', err);
        setStatus('Location denied — using demo', false);
        bootstrapDemoMode(28.6139, 77.2090);
      },
      opts
    );
  }

  function startWatch() {
    if (userWatchId != null) return;
    userWatchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        accuracy = acc;
        lastRealPos = { lat: latitude, lng: longitude };
        const self = members.find(m => m.isSelf);
        if (self) {
          const prevLat = self.lat;
          const prevLng = self.lng;
          self.lat = latitude;
          self.lng = longitude;
          self.lastUpdate = Date.now();
          // detect zone transitions for self
          zones.forEach(z => {
            const key = self.id + '-' + z.id;
            const now = isInside(self, z);
            if (previousState[key] !== undefined && previousState[key] !== now) {
              addActivity({
                type: now ? 'entry' : 'exit',
                title: now ? 'Safe-zone entry' : 'Safe-zone exit',
                body: `${self.name} ${now ? 'entered' : 'left'} ${z.name}.`,
                good: now,
                danger: !now
              });
              toast(`${self.name} ${now ? 'entered' : 'left'} ${z.name}`);
            }
            previousState[key] = now;
          });
          refresh();
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  }

  function ensureSelfMember(lat, lng) {
    let self = members.find(m => m.isSelf);
    if (!self) {
      const c = COLORS[0];
      self = {
        id: 'self',
        name: 'You',
        initials: 'YO',
        color: c.color,
        cls: c.cls,
        lat,
        lng,
        battery: 100,
        role: 'Admin',
        isSelf: true,
        lastUpdate: Date.now()
      };
      members.unshift(self);
      document.getElementById('profileAvatar').textContent = 'YO';
      document.getElementById('profileName').textContent = 'You';
    } else {
      self.lat = lat;
      self.lng = lng;
      self.lastUpdate = Date.now();
    }

    // Real battery if available
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        self.battery = Math.round(b.level * 100);
        b.addEventListener('levelchange', () => {
          self.battery = Math.round(b.level * 100);
          if (self.battery < 20) {
            addActivity({
              type: 'battery',
              title: 'Low battery detected',
              body: `Your device is at ${self.battery}%.`,
              danger: true
            });
          }
          refresh();
        });
        refresh();
      }).catch(() => {});
    }
  }

  // ── Demo members (realistic simulation around user) ────────────────────
  function bootstrapDemoMembers(lat, lng) {
    if (members.some(m => !m.isSelf)) return;

    const demo = [
      { name: 'Aarav Sharma', initials: 'AS', offset: [0.0012, -0.0008] },
      { name: 'Priya Mehta', initials: 'PM', offset: [-0.0009, 0.0011] },
      { name: 'Rohan Kapoor', initials: 'RK', offset: [0.0007, 0.0014] }
    ];

    demo.forEach((d, i) => {
      const c = COLORS[(i + 1) % COLORS.length];
      members.push({
        id: 'm' + (i + 1),
        name: d.name,
        initials: d.initials,
        color: c.color,
        cls: c.cls,
        lat: lat + d.offset[0],
        lng: lng + d.offset[1],
        battery: 55 + Math.floor(Math.random() * 40),
        role: 'Member',
        isSelf: false,
        lastUpdate: Date.now(),
        // small velocity for natural movement
        vx: (Math.random() - 0.5) * 0.00004,
        vy: (Math.random() - 0.5) * 0.00004
      });
    });
  }

  function bootstrapDefaultZones(lat, lng) {
    if (zones.length) return;
    zones = [
      {
        id: 1,
        name: 'Home',
        lat: lat + 0.0015,
        lng: lng - 0.0012,
        radius: 280,
        color: '#10b981'
      },
      {
        id: 2,
        name: 'Campus / Office',
        lat: lat - 0.0008,
        lng: lng + 0.0010,
        radius: 420,
        color: '#3b82f6'
      }
    ];
    // seed previous state
    zones.forEach(z => {
      members.forEach(m => {
        previousState[m.id + '-' + z.id] = isInside(m, z);
      });
    });
  }

  function bootstrapDemoMode(lat, lng) {
    initMap(lat, lng);
    ensureSelfMember(lat, lng);
    bootstrapDemoMembers(lat, lng);
    bootstrapDefaultZones(lat, lng);
    refresh();
    startSimulation();
  }

  // ── Live simulation for other members ──────────────────────────────────
  function simulate() {
    if (paused) return;
    const self = members.find(m => m.isSelf);
    const anchor = lastRealPos || (self ? { lat: self.lat, lng: self.lng } : null);

    members.forEach(m => {
      if (m.isSelf) return; // real GPS handles self

      // natural random walk + slight pull toward anchor
      m.vx += (Math.random() - 0.5) * 0.000008;
      m.vy += (Math.random() - 0.5) * 0.000008;
      // damp velocity
      m.vx *= 0.92;
      m.vy *= 0.92;
      // soft attract to keep them near the family
      if (anchor) {
        m.vx += (anchor.lat - m.lat) * 0.000002;
        m.vy += (anchor.lng - m.lng) * 0.000002;
      }
      m.lat += m.vx;
      m.lng += m.vy;
      m.lastUpdate = Date.now();

      // occasional battery drain
      if (Math.random() < 0.04 && m.battery > 5) {
        m.battery--;
        if (m.battery === 15 || m.battery === 10 || m.battery === 5) {
          addActivity({
            type: 'battery',
            title: 'Low battery detected',
            body: `${m.name}’s device is at ${m.battery}%.`,
            danger: true
          });
        }
      }

      // zone transitions
      zones.forEach(z => {
        const key = m.id + '-' + z.id;
        const now = isInside(m, z);
        if (previousState[key] !== undefined && previousState[key] !== now) {
          addActivity({
            type: now ? 'entry' : 'exit',
            title: now ? 'Safe-zone entry' : 'Safe-zone exit',
            body: `${m.name} ${now ? 'entered' : 'left'} ${z.name}.`,
            good: now,
            danger: !now
          });
          toast(`${m.name} ${now ? 'entered' : 'left'} ${z.name}`);
        }
        previousState[key] = now;
      });
    });

    refresh();
  }

  function startSimulation() {
    if (timer) clearInterval(timer);
    timer = setInterval(simulate, 2200);
  }

  // ── View switching ─────────────────────────────────────────────────────
  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === id));
    const titles = {
      dashboard: 'Live safety dashboard',
      zones: 'Safe-zone management',
      alerts: 'Safety alerts',
      members: 'Trusted circle members'
    };
    document.getElementById('viewTitle').textContent = titles[id] || id;
    if (id === 'dashboard' && map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  }

  // ── Event wiring ───────────────────────────────────────────────────────
  document.querySelectorAll('.nav').forEach(n => {
    n.onclick = () => showView(n.dataset.view);
  });
  document.querySelectorAll('[data-jump]').forEach(b => {
    b.onclick = () => showView(b.dataset.jump);
  });

  document.getElementById('fitBtn').onclick = () => {
    if (!map) return;
    const layers = [...Object.values(markers), ...Object.values(circles)];
    if (layers.length) {
      map.fitBounds(L.featureGroup(layers).getBounds().pad(0.12));
    }
  };

  document.getElementById('pauseBtn').onclick = e => {
    paused = !paused;
    e.currentTarget.textContent = paused ? 'Resume' : 'Pause';
    toast(paused ? 'Live updates paused' : 'Live updates resumed');
  };

  document.getElementById('sosBtn').onclick = () => {
    document.getElementById('sosDialog').showModal();
  };

  document.getElementById('sosDialog').addEventListener('close', e => {
    if (e.target.returnValue === 'confirm') {
      const self = members.find(m => m.isSelf);
      addActivity({
        type: 'sos',
        title: 'SOS triggered',
        body: `Emergency alert shared with ${members.length - 1} trusted members. Latest location attached.`,
        danger: true
      });
      if (self && markers[self.id]) markers[self.id].openPopup();
      toast('SOS alert sent to your trusted circle');
    }
  });

  document.getElementById('addZoneBtn').onclick = () => {
    document.getElementById('zoneDialog').showModal();
  };

  document.getElementById('zoneDialog').addEventListener('close', e => {
    if (e.target.returnValue === 'confirm' && map) {
      const c = map.getCenter();
      const name = document.getElementById('zoneName').value.trim() || 'New zone';
      const radius = +document.getElementById('zoneRadius').value || 300;
      const id = Date.now();
      zones.push({
        id,
        name,
        radius,
        lat: c.lat,
        lng: c.lng,
        color: COLORS[zones.length % COLORS.length].color
      });
      members.forEach(m => {
        previousState[m.id + '-' + id] = isInside(m, zones[zones.length - 1]);
      });
      refresh();
      toast('Safe zone created at map centre');
    }
  });

  function openInvite() {
    document.getElementById('inviteDialog').showModal();
  }
  document.getElementById('inviteBtn').onclick = openInvite;
  document.getElementById('addMemberBtn').onclick = openInvite;

  document.getElementById('inviteDialog').addEventListener('close', e => {
    if (e.target.returnValue === 'confirm') {
      const name = document.getElementById('inviteName').value.trim() || 'New Member';
      const initials = name
        .split(/\s+/)
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      const c = COLORS[members.length % COLORS.length];
      const self = members.find(m => m.isSelf);
      const baseLat = self ? self.lat : 28.61;
      const baseLng = self ? self.lng : 77.21;
      const m = {
        id: 'm' + Date.now(),
        name,
        initials,
        color: c.color,
        cls: c.cls,
        lat: baseLat + (Math.random() - 0.5) * 0.003,
        lng: baseLng + (Math.random() - 0.5) * 0.003,
        battery: 40 + Math.floor(Math.random() * 55),
        role: 'Member',
        isSelf: false,
        lastUpdate: Date.now(),
        vx: (Math.random() - 0.5) * 0.00003,
        vy: (Math.random() - 0.5) * 0.00003
      };
      members.push(m);
      zones.forEach(z => {
        previousState[m.id + '-' + z.id] = isInside(m, z);
      });
      refresh();
      toast(`${name} added to the circle`);
      document.getElementById('inviteName').value = '';
      document.getElementById('inviteEmail').value = '';
    }
  });

  document.getElementById('clearAlertsBtn').onclick = () => {
    activities.forEach(a => (a.read = true));
    renderActivities();
    toast('All alerts marked as read');
  };

  document.getElementById('locateBtn').onclick = () => {
    if (!navigator.geolocation) return toast('Geolocation unavailable');
    navigator.geolocation.getCurrentPosition(
      p => {
        const { latitude, longitude, accuracy: acc } = p.coords;
        accuracy = acc;
        lastRealPos = { lat: latitude, lng: longitude };
        ensureSelfMember(latitude, longitude);
        if (map) {
          map.setView([latitude, longitude], 16);
        } else {
          initMap(latitude, longitude);
        }
        refresh();
        toast('Using your current location');
        setStatus('Live GPS connected');
        startWatch();
      },
      () => toast('Location permission denied'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  window.focusZone = id => {
    const z = zones.find(x => x.id === id);
    if (!z || !map) return;
    showView('dashboard');
    map.setView([z.lat, z.lng], 16);
    if (circles[id]) circles[id].openPopup();
  };

  // ── Boot ───────────────────────────────────────────────────────────────
  startRealLocation();

  // Keep relative times fresh
  setInterval(() => {
    renderMembers();
    renderActivities();
  }, 15000);
})();
