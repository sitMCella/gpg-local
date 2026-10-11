package com.gpglocal.app.ui.common

/** How the Encrypt / Decrypt screens are hosted. */
enum class Presentation {
    /** A tab in MainActivity: bottom navigation, Change button, success snackbar. */
    Tab,

    /** Started from the share sheet or "Open with" (ShareActivity): fixed file, result step instead of a snackbar. */
    Share,
}
