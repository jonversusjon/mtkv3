import React from "react";

function RestrictionSiteSummary({ restrictionSites }) {
  if (!restrictionSites || restrictionSites.length === 0) return null;

  return (
    <div className="mb-8 rounded-lg overflow-hidden">
      <h3 className="text-lg font-bold mb-3">Internal BsaI/BsmbI sites found</h3>
      <div className="max-w-lg">
        <div className="overflow-hidden rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <table className="w-full border-collapse bg-white dark:bg-gray-800 text-sm text-left text-gray-800 dark:text-gray-200">
            <caption className="sr-only">Internal restriction sites found in sequence</caption>
            <thead>
              <tr>
                <th scope="col" className="bg-gray-700 dark:bg-gray-800 text-gray-50 py-3 px-4 text-center font-bold text-sm rounded-tl-lg">
                  Enzyme
                </th>
                <th scope="col" className="bg-gray-700 dark:bg-gray-800 text-gray-50 py-3 px-4 text-center font-bold text-sm">
                  Sequence
                </th>
                <th scope="col" className="bg-gray-700 dark:bg-gray-800 text-gray-50 py-3 px-4 text-center font-bold text-sm">
                  Position
                </th>
                <th scope="col" className="bg-gray-700 dark:bg-gray-800 text-gray-50 py-3 px-4 text-center font-bold text-sm rounded-tr-lg">
                  Strand
                </th>
              </tr>
            </thead>
            <tbody>
              {restrictionSites.map((site, index) => {
                const isLastRow = index === restrictionSites.length - 1;
                const isEven = index % 2 === 0;
                
                return (
                  <tr 
                    key={index}
                    className={`
                      ${isEven ? 'bg-gray-50/30 dark:bg-gray-700/20' : 'bg-white dark:bg-gray-800'}
                      hover:bg-gray-100 dark:hover:bg-gray-600/50 transition-colors duration-200
                    `}
                  >
                    <td className={`py-3 px-4 text-center border border-gray-200 dark:border-gray-700 ${isLastRow ? 'rounded-bl-xl' : ''}`}>
                      {site.enzyme}
                    </td>
                    <td className="py-3 px-4 text-center border border-gray-200 dark:border-gray-700 break-words">
                      <code className="font-mono text-xs tracking-wide">{site.recognitionSeq}</code>
                    </td>
                    <td className="py-3 px-4 text-center border border-gray-200 dark:border-gray-700">
                      {site.position}
                    </td>
                    <td className={`py-3 px-4 text-center border border-gray-200 dark:border-gray-700 ${isLastRow ? 'rounded-br-xl' : ''}`}>
                      {site.strand}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default RestrictionSiteSummary;