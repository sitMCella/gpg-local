import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface PathBreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
}

function splitPath(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean)
}

function buildPathUpTo(segments: string[], index: number, isAbsolute: boolean): string {
  const joined = segments.slice(0, index + 1).join('/')
  return isAbsolute ? `/${joined}` : joined
}

export default function PathBreadcrumb({ path, onNavigate }: PathBreadcrumbProps) {
  const isAbsolute = path.startsWith('/')
  const segments = splitPath(path)

  return (
    <div className="flex-1 overflow-x-auto">
      <Breadcrumb>
        <BreadcrumbList className="flex-nowrap whitespace-nowrap">
          {segments.map((segment, i) => {
            const isLast = i === segments.length - 1
            const segmentPath = buildPathUpTo(segments, i, isAbsolute)
            return (
              <Fragment key={segmentPath}>
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{segment}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        onNavigate(segmentPath)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          onNavigate(segmentPath)
                        }
                      }}
                    >
                      {segment}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
