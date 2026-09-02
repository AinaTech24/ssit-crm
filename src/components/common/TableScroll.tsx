/**
 * Responsive wrapper for wide data tables. The app is table-heavy (80+ tables)
 * and many overflow the viewport on tablet/mobile. Wrapping a <table> in this
 * gives horizontal scroll with an on-brand thin scrollbar instead of the table
 * blowing out the layout or getting clipped.
 *
 *   <TableScroll>
 *     <table className="w-full text-sm table-modern"> … </table>
 *   </TableScroll>
 */
export function TableScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full overflow-x-auto scrollbar-thin ${className ?? ""}`}>
      {children}
    </div>
  );
}
