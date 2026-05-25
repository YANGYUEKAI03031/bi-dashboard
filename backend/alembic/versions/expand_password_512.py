"""expand_password_column

Revision ID: expand_password_512
Revises: 966efaac8f36
Create Date: 2026-05-25 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'expand_password_512'
down_revision: Union[str, Sequence[str], None] = '966efaac8f36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """扩大databases表password列宽以容纳Fernet加密密文"""
    op.alter_column('databases', 'password', existing_type=sa.String(255), type_=sa.String(512))


def downgrade() -> None:
    """回滚：恢复password列宽为255"""
    op.alter_column('databases', 'password', existing_type=sa.String(512), type_=sa.String(255))
