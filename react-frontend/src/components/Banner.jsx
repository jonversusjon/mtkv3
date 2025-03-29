import React from "react";

function Banner() {
  return (
    <div
      // Removed `relative` and `z-0`. The `mt-24` pushes it down below the fixed header space.
      // Added Tailwind classes for background properties where possible.
      // Replaced h-[360px] for fixed height.
      // Added responsive height adjustments based on original Banner.css [cite: uploaded:src/styles/Banner.css]
      className="w-full mt-24 flex flex-col items-center text-center text-white bg-cover bg-center h-[360px] md:h-[300px]" // [cite: uploaded:src/styles/Banner.css]
      // Keep backgroundImage inline as Tailwind doesn't handle dynamic URLs easily out-of-the-box.
      style={{
        backgroundImage: "url('/DNA_blunt_ends.jpg')", // [cite: uploaded:src/components/Banner.jsx]
      }}
    >
      {/* Text styles using Tailwind utilities */}
      {/* Added text-shadow utilities (note: requires Tailwind JIT/v3+ or custom config) */}
      {/* Added responsive text sizes based on original Banner.css [cite: uploaded:src/styles/Banner.css] */}
      <h1 className="text-6xl lg:text-5xl md:text-4xl font-bold mt-6 text-shadow-lg"> {/* Adjusted responsive sizes, added text-shadow utility example */}
        Advanced primer design for mammalian toolkit
      </h1>
      {/* Adjusted max-width utility and responsive text size */}
      <p className="text-xl md:text-lg max-w-[80%] text-shadow-md mt-2 sm:text-base"> {/* Used max-w-[80%], added responsive size, text-shadow utility example */}
        Plan your experiment with one template and up to 10 sequences to domesticate.
      </p>
    </div>
  );
}

export default Banner;

// Example (add to your global CSS or index.css if needed, requires Tailwind JIT/v3+):
/*
@layer utilities {
  .text-shadow-lg {
    text-shadow: 2px 2px 10px rgba(0, 0, 0, 0.5);
  }
  .text-shadow-md {
    text-shadow: 2px 2px 10px rgba(0, 0, 0, 0.3);
  }
}
*/