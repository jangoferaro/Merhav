import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Ishmael from "./pages/Ishmael";
import NotFound from "./pages/NotFound";
import DevSeed from "./pages/DevSeed";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      {/* מנוע הידע — שיחה עם מערכת הרעיונות של דניאל קווין */}
      <Route path={"/ishmael"} component={Ishmael} />
      {/* נתיב פיתוח בלבד — מזריק מסע לדוגמה כדי לבדוק ויזואלית את מסך המסע */}
      <Route path={"/dev-seed"} component={DevSeed} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <Router />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
