import { io } from "socket.io-client";
const T1 = process.argv[2], T2 = process.argv[3];
function connect(name, token) {
  return new Promise((resolve) => {
    const s = io("http://localhost:3001", { auth: { token } });
    s.on("connect", () => { console.log(`[${name}] connected`); resolve(s); });
    s.onAny((ev, ...args) => console.log(`[${name}] << ${ev}`, JSON.stringify(args).slice(0,300)));
  });
}
async function run() {
  const s1 = await connect("A", T1);
  const s2 = await connect("B", T2);
  await new Promise(r => setTimeout(r, 500));
  console.log("\n=== A creates room ===");
  s1.emit("room:create", { name: "TestRoom", gameType: "six-nimmt", maxPlayers: 4 });
  await new Promise(r => setTimeout(r, 1000));
  console.log("\n=== DONE ===");
  s1.disconnect(); s2.disconnect(); process.exit(0);
}
run();
