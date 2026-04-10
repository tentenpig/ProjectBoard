import { Server } from 'socket.io';

const EVENTS_PER_DAY = 3;
const EVENT_DURATION_MS = 60 * 60 * 1000; // 1 hour
const LOCATIONS = ['river', 'lake', 'sea'];
const LOCATION_NAMES: Record<string, string> = { river: '🏞️ 강', lake: '🌊 호수', sea: '🌅 바다' };

export interface FishingEvent {
  location: string;
  startTime: number;
  endTime: number;
  active: boolean;
}

let todayEvents: FishingEvent[] = [];
let io: Server | null = null;

function generateDayEvents(): FishingEvent[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  const events: FishingEvent[] = [];
  const usedHours = new Set<number>();

  for (let i = 0; i < EVENTS_PER_DAY; i++) {
    // Pick random hour (8:00 ~ 22:00), avoid duplicates
    let hour: number;
    do {
      hour = 8 + Math.floor(Math.random() * 14); // 8~21
    } while (usedHours.has(hour));
    usedHours.add(hour);

    const startTime = todayStart + hour * 60 * 60 * 1000;
    const endTime = startTime + EVENT_DURATION_MS;
    const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];

    events.push({
      location,
      startTime,
      endTime,
      active: false,
    });
  }

  return events.sort((a, b) => a.startTime - b.startTime);
}

function checkEvents() {
  const now = Date.now();

  for (const event of todayEvents) {
    if (!event.active && now >= event.startTime && now < event.endTime) {
      // Event starts
      event.active = true;
      console.log(`[FishEvent] Started: ${event.location}`);
      if (io) {
        io.emit('fishing:event_start', {
          location: event.location,
          locationName: LOCATION_NAMES[event.location],
          endTime: event.endTime,
        });
      }
    } else if (event.active && now >= event.endTime) {
      // Event ends
      event.active = false;
      console.log(`[FishEvent] Ended: ${event.location}`);
      if (io) {
        io.emit('fishing:event_end', {
          location: event.location,
          locationName: LOCATION_NAMES[event.location],
        });
      }
    }
  }
}

export function getActiveEvent(): FishingEvent | null {
  const now = Date.now();
  return todayEvents.find((e) => e.active && now >= e.startTime && now < e.endTime) || null;
}

export function getActiveEventForLocation(location: string): FishingEvent | null {
  const event = getActiveEvent();
  return event && event.location === location ? event : null;
}

export function getAllEvents(): FishingEvent[] {
  return todayEvents;
}

export function initFishEventScheduler(socketIo: Server) {
  io = socketIo;
  todayEvents = generateDayEvents();
  console.log(`[FishEvent] Today's events:`, todayEvents.map((e) => `${e.location} ${new Date(e.startTime).toLocaleTimeString()}`));

  // Check every 30 seconds
  setInterval(checkEvents, 30 * 1000);
  checkEvents(); // Initial check

  // Regenerate at midnight
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      todayEvents = generateDayEvents();
      console.log(`[FishEvent] New day events:`, todayEvents.map((e) => `${e.location} ${new Date(e.startTime).toLocaleTimeString()}`));
    }
  }, 60 * 1000);
}
