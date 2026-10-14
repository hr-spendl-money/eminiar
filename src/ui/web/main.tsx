import { render } from "preact";
import { App } from "./app.js";

const el = document.getElementById("app");
if (el) render(<App />, el);
