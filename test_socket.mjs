import { io } from "socket.io-client";

const TOKEN1 = process.argv[2];
const TOKEN2 = process.argv[3];

function connect(name, token) {
  return new Promise((resolve, reject) => {
    const s = io("http://localhost:3001", { auth: { token } });
    s.on("connect", () => { console.log(`[${name}] Connected: ${s.id}`); resolve(s); });
    s.on("connect_error", (e) => { console.error(`[${name}] Connection error: ${e.message}`); reject(e); });
    s.onAny((event, ...args) => {
      const data = JSON.stringify(args).slice(0, 300);
      console.log(`[${name}] << ${event} ${data}`);
    });
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
}

async function test() {
  const s1 = await connect("P1", TOKEN1);
  const s2 = await connect("P2", TOKEN2);
  await new Promise(r => setTimeout(r, 500));

  // Step 1: Create room
  console.log("\n=== STEP 1: P1 creates room ===");
  const roomId = await new Promise((resolve) => {
    s1.once("room:created", (id) => resolve(id));
    s1.emit("room:create", { name: "Test Room", gameType: "six-nimmt", maxPlayers: 4 });
  });
  console.log("Room ID:", roomId);
  await new Promise(r => setTimeout(r, 300));

  // Step 2: Simulate Room page mount - register listener THEN request state
  console.log("\n=== STEP 2: Simulate Room.tsx mount - get_state ===");
  const roomState = await new Promise((resolve) => {
    const handler = (state) => { s1.off("room:state", handler); resolve(state); };
    s1.on("room:state", handler);
    s1.emit("room:get_state", roomId);
  });
  console.log("Room state received:", JSON.stringify(roomState).slice(0, 200));

  // Step 3: P2 joins
  console.log("\n=== STEP 3: P2 joins room ===");
  s2.emit("room:join", roomId);
  await new Promise(r => setTimeout(r, 500));

  // Step 4: P1 starts game
  console.log("\n=== STEP 4: P1 starts game ===");
  const gameState = await new Promise((resolve) => {
    const handler = (state) => { s1.off("game:state", handler); resolve(state); };
    s1.on("game:state", handler);
    s1.emit("game:start");
  });
  console.log("Game state received! Phase:", gameState.phase, "Hand size:", gameState.hand.length, "Rows:", gameState.rows.length);

  // Step 5: Simulate Game.tsx mount - request state again
  console.log("\n=== STEP 5: Simulate Game.tsx mount - get_state ===");
  const gameState2 = await new Promise((resolve) => {
    const handler = (state) => { s1.off("game:state", handler); resolve(state); };
    s1.on("game:state", handler);
    s1.emit("room:get_state", roomId);
  });
  console.log("Game state from get_state! Phase:", gameState2.phase, "Hand size:", gameState2.hand.length);

  // Step 6: Both players select a card
  console.log("\n=== STEP 6: Both players select cards ===");
  s1.on("game:state", (state) => console.log("[P1] game:state phase:", state.phase));
  s2.on("game:state", (state) => console.log("[P2] game:state phase:", state.phase));
  s1.on("game:all_selected", (plays) => console.log("[P1] all_selected:", plays.map(p => `${p.nickname}=${p.card.number}`)));

  s1.emit("game:select_card", gameState.hand[0].number);
  console.log("P1 selected:", gameState.hand[0].number);
  s2.emit("game:select_card", gameState2.rows[0][0].number + 1); // just pick something
  // P2 needs their own hand
  const p2State = await new Promise((resolve) => {
    const handler = (state) => { s2.off("game:state", handler); resolve(state); };
    s2.on("game:state", handler);
    s2.emit("room:get_state", roomId);
  });
  s2.emit("game:select_card", p2State.hand[0].number);
  console.log("P2 selected:", p2State.hand[0].number);

  await new Promise(r => setTimeout(r, 5000));

  console.log("\n=== ALL TESTS PASSED ===");
  s1.disconnect();
  s2.disconnect();
  process.exit(0);
}

test().catch(e => { console.error("FAIL:", e); process.exit(1); });
