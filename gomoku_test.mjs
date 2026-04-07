import { io } from "socket.io-client";
const T = process.argv[2];
const s = io("http://localhost:3001", { auth: { token: T } });
s.onAny((ev, ...args) => console.log(`<< ${ev}`, JSON.stringify(args).slice(0,400)));
s.on("connect", async () => {
  console.log("connected");
  s.emit("room:create", { name: "Gomoku Test", gameType: "gomoku", maxPlayers: 2 });
  await new Promise(r => setTimeout(r, 500));
  s.emit("room:add_bot");
  await new Promise(r => setTimeout(r, 500));
  console.log("\n=== Starting game ===");
  s.emit("game:start");
  await new Promise(r => setTimeout(r, 2000));
  console.log("\n=== Done ===");
  s.disconnect();
  process.exit(0);
});
