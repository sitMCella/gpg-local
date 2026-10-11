# JNA looks up classes, fields and methods reflectively; UniFFI-generated
# bindings in com.gpglocal.core are called through JNA. Keep both intact.
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
-keep class com.gpglocal.core.** { *; }
-dontwarn java.awt.**
