"""Local operator-only migration and role administration; never exposed over HTTP."""
import argparse
import asyncio
from uuid import UUID
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from services.common.database import close_db, get_session_factory
from services.common.models import OperatorRole, User
from services.experiment_controller.auth import init_auth_db


async def run(action, user_id):
    try:
        await init_auth_db()
        if action == "migrate":
            print("Auth schema migration v1 applied or already present.")
            return
        async with get_session_factory()() as session:
            user = await session.get(User, user_id)
            if not user or user.is_demo:
                raise ValueError("A non-demo account UUID is required")
            if action == "grant":
                await session.execute(insert(OperatorRole).values(user_id=user.id).on_conflict_do_nothing())
            else:
                await session.execute(delete(OperatorRole).where(OperatorRole.user_id == user.id))
            await session.commit()
            print("Operator grant updated.")
    finally:
        await close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["migrate", "grant", "revoke"])
    parser.add_argument("--user-id", type=UUID)
    args = parser.parse_args()
    if args.action != "migrate" and not args.user_id:
        parser.error("--user-id is required for grant/revoke")
    asyncio.run(run(args.action, args.user_id))
