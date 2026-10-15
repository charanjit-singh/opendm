// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { render } from "preact";
import { App } from "./App";
import "./styles/index.css";

const root = document.getElementById("root");
if (root) render(<App />, root);
