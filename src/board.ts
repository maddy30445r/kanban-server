import { pg } from "./db.js";

export async function isMember(boardId:string,userId:string){
    const res=await pg.query(
        "SELECT 1 FROM board_members where board_id=$1 AND user_id=$2",[boardId,userId]
    );
    return res.rowCount!==null&&res.rowCount>0;
}

export type BoardSummary={id:string,name:string}

export async function listBoardsForUser(userId:string){
    const res=await pg.query(
        `SELECT b.id , b.name FROM boards b JOIN board_members m on m.board_id=b.id
        WHERE m.user_id=$1 ORDER by b.name`,[userId]
    );
    return res.rows;
}