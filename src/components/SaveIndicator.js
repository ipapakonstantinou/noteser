// src/components/SaveIndicator.js
import { useEffect, useState } from "react";

const SaveIndicator = ({ isSaved }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isSaved) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
}, [isSaved]);

return visible ? (<div>Saved!</div>) : null;
};

export default SaveIndicator;
