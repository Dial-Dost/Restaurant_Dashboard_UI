// THE BODY OF THE ONE "ORDER MOVED" TOAST — client item 4, review finding.
//
// The toast store keeps a single toast (hooks/use-toast.ts, TOAST_LIMIT = 1),
// so everything a move has to say is said here at once: what moved and what
// the pass must be told, then every bill that now needs reprinting. The page
// draws one "Open <table>" per reprint beside it. The words are built by
// moveOrderNotice (lib/table-move.ts); this only lays them out.
//
// Relative imports and no UI kit, deliberately: the jest suite renders this
// with react-dom/server, and its config maps no "@/" alias.

import type { ReactElement } from "react";
import type { MoveOrderNotice } from "../../../lib/table-move";

export function MoveOrderNoticeBody({ notice }: { notice: MoveOrderNotice }): ReactElement {
    return (
        <div className="space-y-1.5" data-testid="move-order-notice">
            <p>{notice.sentence}</p>
            {notice.reprints.map((reprint) => (
                <p key={reprint.table} className="font-medium" data-testid="move-order-reprint">
                    {reprint.message}
                </p>
            ))}
        </div>
    );
}
