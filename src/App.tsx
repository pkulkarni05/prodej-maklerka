import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import BookingPage from "./pages/BookingPage";
import Home from "./pages/Home";
import ThankYouPage from "./pages/ThankYouPage";
import SalesFinanceForm from "./pages/SalesFinanceForm";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/book/:propertyCode" element={<BookingPage />} />
        <Route path="/thank-you" element={<ThankYouPage />} />
        <Route path="/:propertyCode" element={<SalesFinanceForm />} />
      </Routes>
    </Router>
  );
}
