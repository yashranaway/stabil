// Register only the Chart.js pieces our report uses, for tree-shaking.
// Importing this module is idempotent — Chart.js's registry de-dupes.
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);
