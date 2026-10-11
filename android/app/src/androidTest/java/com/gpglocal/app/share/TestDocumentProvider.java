package com.gpglocal.app.share;

import android.content.ContentProvider;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Read-only, in-memory document provider for share tests. Documents are added through {@link #put} and
 * served through a pipe, so the app streams them exactly as from a real provider. Names starting with
 * {@code slow-} delay the first byte, to keep an operation running long enough to observe its loading
 * state.
 *
 * <p>Written in Java on purpose: the provider runs in the test package's own process, and the test APK
 * does not contain the Kotlin standard library (it is deduplicated against the app APK), so Kotlin code
 * here fails with {@code NoClassDefFoundError: kotlin/jvm/internal/Intrinsics}.
 */
public class TestDocumentProvider extends ContentProvider {

    public static final String AUTHORITY = "com.gpglocal.app.test.documents";
    public static final String SLOW_PREFIX = "slow-";
    public static final long SLOW_DELAY_MS = 3_000L;
    private static final String METHOD_PUT = "put";
    private static final String METHOD_CLEAR = "clear";
    private static final String EXTRA_BYTES = "bytes";

    // The provider runs in the test package's own process; documents are added through call().
    private static final ConcurrentHashMap<String, byte[]> documents = new ConcurrentHashMap<>();

    public static Uri uriFor(String name) {
        return new Uri.Builder()
                .scheme(ContentResolver.SCHEME_CONTENT)
                .authority(AUTHORITY)
                .appendPath(name)
                .build();
    }

    public static Uri put(Context context, String name, byte[] bytes) {
        Uri uri = uriFor(name);
        Bundle extras = new Bundle();
        extras.putByteArray(EXTRA_BYTES, bytes);
        context.getContentResolver().call(uri, METHOD_PUT, name, extras);
        return uri;
    }

    public static void clear(Context context) {
        context.getContentResolver().call(uriFor("_"), METHOD_CLEAR, null, null);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        if (METHOD_PUT.equals(method)) {
            byte[] bytes = extras == null ? null : extras.getByteArray(EXTRA_BYTES);
            if (arg == null || bytes == null) throw new IllegalArgumentException("put needs a name and bytes");
            documents.put(arg, bytes);
        } else if (METHOD_CLEAR.equals(method)) {
            documents.clear();
        }
        return null;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        String name = nameOf(uri);
        byte[] bytes = documents.get(name);
        if (bytes == null) throw new IllegalArgumentException(new FileNotFoundException(name));
        String[] columns = projection != null
                ? projection
                : new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            row[i] = OpenableColumns.SIZE.equals(columns[i]) ? (Object) (long) bytes.length : name;
        }
        MatrixCursor cursor = new MatrixCursor(columns);
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new SecurityException("read-only provider");
        String name = nameOf(uri);
        byte[] bytes = documents.get(name);
        if (bytes == null) throw new FileNotFoundException(name);
        ParcelFileDescriptor[] pipe;
        try {
            pipe = ParcelFileDescriptor.createPipe();
        } catch (IOException e) {
            throw new FileNotFoundException(e.getMessage());
        }
        ParcelFileDescriptor write = pipe[1];
        new Thread(() -> {
            try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(write)) {
                if (name.startsWith(SLOW_PREFIX)) Thread.sleep(SLOW_DELAY_MS);
                out.write(bytes);
            } catch (IOException | InterruptedException ignored) {
                // The reader went away; nothing to clean up beyond closing the pipe.
            }
        }, "test-document-" + name).start();
        return pipe[0];
    }

    @Override
    public String getType(Uri uri) {
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    private static String nameOf(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null) throw new IllegalArgumentException("no document name in " + uri);
        return name;
    }
}
