use rand::{rand_core::UnwrapErr, rngs::SysRng};

pub(crate) fn os_rng() -> UnwrapErr<SysRng> {
    UnwrapErr(SysRng)
}
