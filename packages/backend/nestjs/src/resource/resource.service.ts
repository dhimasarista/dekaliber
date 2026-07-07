import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResourceDto } from './dto/create-resource.dto';
import { QueryResourceDto } from './dto/query-resource.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';

@Injectable()
export class ResourceService {
  constructor(private readonly prisma: PrismaService) {}

  // create_brutal — POST /resource beruntun
  create(dto: CreateResourceDto) {
    return this.prisma.resource.create({ data: dto });
  }

  // read_light — GET /resource/:id, overhead routing + serialization murni
  async findOne(id: string) {
    const resource = await this.prisma.resource.findUnique({ where: { id } });
    if (!resource) throw new NotFoundException(`Resource ${id} not found`);
    return resource;
  }

  // read_heavy — GET /resource?filter&sort&page, query planner + N+1 risk + connection pool
  findMany(query: QueryResourceDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    if (query.raw === 'true') {
      return this.findManyRaw(query, page, pageSize);
    }

    const where: Prisma.ResourceWhereInput = query.status ? { status: query.status } : {};
    const orderBy: Prisma.ResourceOrderByWithRelationInput = {
      [query.sort ?? 'createdAt']: query.order ?? 'desc',
    };

    return this.prisma.resource.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  // Versi raw SQL kontrol (bypass ORM) — wajib per §6, sebagai pembanding query_heavy
  private findManyRaw(query: QueryResourceDto, page: number, pageSize: number) {
    const sortColumn = query.sort ?? 'createdAt';
    const order = query.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const sortColumnMap: Record<string, Prisma.Sql> = {
      label: Prisma.sql`"label"`,
      value: Prisma.sql`"value"`,
      createdAt: Prisma.sql`"createdAt"`,
      updatedAt: Prisma.sql`"updatedAt"`,
    };
    const orderByColumn = sortColumnMap[sortColumn] ?? sortColumnMap.createdAt;
    const statusFilter = query.status
      ? Prisma.sql`WHERE "status" = ${query.status}`
      : Prisma.empty;

    return this.prisma.$queryRaw`
      SELECT * FROM "Resource"
      ${statusFilter}
      ORDER BY ${orderByColumn} ${order}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
  }

  // update_brutal — PUT /resource/:id beruntun, row lock contention + index update cost
  async update(id: string, dto: UpdateResourceDto) {
    await this.findOne(id);
    return this.prisma.resource.update({ where: { id }, data: dto });
  }

  // delete_brutal — DELETE /resource/:id beruntun
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.resource.delete({ where: { id } });
  }
}
