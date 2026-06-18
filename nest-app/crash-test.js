process.on("uncaughtException", function(e) {
  process.stdout.write("UNCAUGHT: " + e.message + "\n" + e.stack + "\n");
  process.exit(1);
});
require("./dist/main");
